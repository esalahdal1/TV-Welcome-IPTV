package com.example.tv_guest_welcome

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

object Notifications {
    private const val SUPABASE_URL = "https://ayfvvzawdbdcsiugazvn.supabase.co"
    private const val SUPABASE_KEY = "sb_publishable_V5a3JRO2UI371xQ-9MwT8w_J_8XT8Cm"

    private const val NOTIF_PREFS = "NOTIF_PREFS"
    private const val KEY_LAST_SEEN = "last_seen_created_at"
    private const val KEY_DEFERRED = "deferred_json"

    private const val CHANNEL_ID = "masaken_notifications"
    private const val CHANNEL_NAME = "masaken hotel"

    private const val ACTION_POLL = "com.example.tv_guest_welcome.ACTION_POLL_NOTIFICATIONS"
    private const val REQUEST_CODE_POLL = 44021

    private const val POLL_INTERVAL_MS = 60_000L
    private const val DEFER_MS = 5 * 60_000L

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    @Volatile
    private var foregroundCallback: ((String) -> Unit)? = null

    @Volatile
    private var isForeground: Boolean = false

    fun bindForeground(window: Window, callback: (String) -> Unit) {
        isForeground = true
        foregroundCallback = { msg ->
            InAppBanner.show(window, msg)
            callback(msg)
        }
    }

    fun unbindForeground() {
        isForeground = false
        foregroundCallback = null
    }

    fun ensurePostNotificationsPermission(activity: androidx.appcompat.app.AppCompatActivity) {
        if (Build.VERSION.SDK_INT < 33) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 9021)
    }

    fun ensureScheduled(context: Context) {
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = pollPendingIntent(context)
        val triggerAt = SystemClock.elapsedRealtime() + 15_000L

        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending)
            } else {
                alarm.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending)
            }
        }

        alarm.setInexactRepeating(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            triggerAt + 30_000L,
            POLL_INTERVAL_MS,
            pending
        )
    }

    private fun scheduleOneShot(context: Context, delayMs: Long) {
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = pollPendingIntent(context)
        val triggerAt = SystemClock.elapsedRealtime() + delayMs
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending)
            } else {
                alarm.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending)
            }
        }
    }

    private fun pollPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, NotificationPollReceiver::class.java).setAction(ACTION_POLL)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getBroadcast(context, REQUEST_CODE_POLL, intent, flags)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val existing = manager.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT)
        manager.createNotificationChannel(channel)
    }

    private fun postSystemNotification(context: Context, message: String) {
        ensureChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pending = openIntent?.let {
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            PendingIntent.getActivity(context, 0, it, flags)
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("masaken hotel")
            .setContentText(message)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        val id = UUID.randomUUID().hashCode()
        manager.notify(id, notification)
    }

    private fun readRoomNumber(context: Context): String? {
        val prefs = context.getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
        return prefs.getString("room_number", null)?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun getLastSeen(context: Context): String? {
        val prefs = context.getSharedPreferences(NOTIF_PREFS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LAST_SEEN, null)?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun setLastSeen(context: Context, createdAt: String) {
        val prefs = context.getSharedPreferences(NOTIF_PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LAST_SEEN, createdAt).apply()
    }

    private fun loadDeferred(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(NOTIF_PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_DEFERRED, null)?.trim().orEmpty()
        return runCatching { JSONArray(raw) }.getOrNull() ?: JSONArray()
    }

    private fun saveDeferred(context: Context, arr: JSONArray) {
        val prefs = context.getSharedPreferences(NOTIF_PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DEFERRED, arr.toString()).apply()
    }

    private fun isInteractive(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isInteractive
    }

    private fun fetchNew(context: Context, roomNumber: String?, lastSeen: String?): List<JSONObject> {
        val base = "$SUPABASE_URL/rest/v1/tv_notifications"
        val select = "select=id,room_number,message,created_at"
        val audience = if (roomNumber.isNullOrEmpty()) {
            "room_number=is.null"
        } else {
            "or=(room_number.is.null,room_number.eq.$roomNumber)"
        }
        val order = "order=created_at.asc"
        val filter = lastSeen?.let { "created_at=gt.$it" }

        val url = buildString {
            append(base)
            append("?")
            append(select)
            append("&")
            append(audience)
            append("&")
            append(order)
            if (!filter.isNullOrEmpty()) {
                append("&")
                append(filter)
            }
        }

        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SUPABASE_KEY)
            .addHeader("Authorization", "Bearer $SUPABASE_KEY")
            .build()

        val body = client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) return emptyList()
            resp.body?.string().orEmpty()
        }

        val arr = runCatching { JSONArray(body) }.getOrNull() ?: return emptyList()
        val out = ArrayList<JSONObject>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(o)
        }
        return out
    }

    private fun deliverNow(context: Context, message: String) {
        val cb = foregroundCallback
        if (isForeground && cb != null) {
            cb.invoke(message)
        } else {
            postSystemNotification(context, message)
        }
    }

    private fun processDeferred(context: Context, nowMs: Long) {
        val deferred = loadDeferred(context)
        if (deferred.length() == 0) return

        val remaining = JSONArray()
        for (i in 0 until deferred.length()) {
            val o = deferred.optJSONObject(i) ?: continue
            val deliverAt = o.optLong("deliverAt", 0L)
            val message = o.optString("message", "").trim()
            if (deliverAt > 0 && message.isNotEmpty() && deliverAt <= nowMs) {
                deliverNow(context, message)
            } else {
                remaining.put(o)
            }
        }
        saveDeferred(context, remaining)
    }

    private fun deferMessage(context: Context, message: String, deliverAtMs: Long) {
        val deferred = loadDeferred(context)
        val item = JSONObject()
        item.put("message", message)
        item.put("deliverAt", deliverAtMs)
        deferred.put(item)
        saveDeferred(context, deferred)
    }

    internal fun handlePollBroadcast(receiver: BroadcastReceiver, context: Context, intent: Intent?) {
        if (intent?.action != ACTION_POLL) return
        val pending = receiver.goAsync()
        Thread {
            try {
                pollOnce(context)
            } catch (_: Throwable) {
            } finally {
                pending.finish()
            }
        }.start()
    }

    fun pollOnce(context: Context) {
        val room = readRoomNumber(context)
        val nowMs = System.currentTimeMillis()
        processDeferred(context, nowMs)

        val lastSeen = getLastSeen(context)
        val items = fetchNew(context, room, lastSeen)
        if (items.isEmpty()) return

        var maxCreatedAt: String? = lastSeen
        val interactive = isInteractive(context)
        for (o in items) {
            val message = o.optString("message", "").trim()
            val createdAt = o.optString("created_at", "").trim()
            if (message.isEmpty() || createdAt.isEmpty()) continue
            maxCreatedAt = createdAt

            if (!interactive) {
                deferMessage(context, message, nowMs + DEFER_MS)
            } else {
                deliverNow(context, message)
            }
        }

        if (!maxCreatedAt.isNullOrEmpty()) {
            setLastSeen(context, maxCreatedAt)
        }

        if (!interactive) {
            scheduleOneShot(context, DEFER_MS)
        }
    }

    fun pollAsync(context: Context) {
        val appContext = context.applicationContext
        Thread {
            runCatching { pollOnce(appContext) }
        }.start()
    }
}

private object InAppBanner {
    private const val TAG = "masaken_in_app_banner"
    private val TAG_HIDE_KEY: Int = View.generateViewId()

    fun show(window: Window, message: String) {
        val decor = window.decorView as? ViewGroup ?: return
        val existing = decor.findViewWithTag<View>(TAG) as? FrameLayout

        val container = existing ?: FrameLayout(decor.context).also { c ->
            c.tag = TAG
            c.isClickable = false
            c.isFocusable = false
            val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.gravity = Gravity.TOP
            lp.topMargin = (18 * decor.resources.displayMetrics.density).toInt()
            lp.marginStart = (26 * decor.resources.displayMetrics.density).toInt()
            lp.marginEnd = lp.marginStart
            c.layoutParams = lp

            val tv = TextView(decor.context)
            tv.tag = "${TAG}_text"
            tv.setTextColor(Color.WHITE)
            tv.textSize = 18f
            tv.setPadding(
                (18 * decor.resources.displayMetrics.density).toInt(),
                (12 * decor.resources.displayMetrics.density).toInt(),
                (18 * decor.resources.displayMetrics.density).toInt(),
                (12 * decor.resources.displayMetrics.density).toInt()
            )
            tv.maxLines = 2

            val bg = GradientDrawable()
            bg.cornerRadius = 16f * decor.resources.displayMetrics.density
            bg.setColor(Color.parseColor("#AA000000"))
            bg.setStroke((1 * decor.resources.displayMetrics.density).toInt().coerceAtLeast(1), Color.parseColor("#33FFFFFF"))
            tv.background = bg

            c.addView(tv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            decor.addView(c)
        }

        val tv = container.findViewWithTag<TextView>("${TAG}_text") ?: return
        tv.text = message
        container.alpha = 0f
        container.visibility = View.VISIBLE
        container.animate().alpha(1f).setDuration(180).start()
        val old = container.getTag(TAG_HIDE_KEY) as? Runnable
        if (old != null) container.removeCallbacks(old)
        val r = hideRunnable(container)
        container.setTag(TAG_HIDE_KEY, r)
        container.postDelayed(r, 5000L)
    }

    private fun hideRunnable(container: FrameLayout): Runnable {
        return Runnable {
            container.animate().alpha(0f).setDuration(220).withEndAction {
                container.visibility = View.GONE
                container.alpha = 1f
            }.start()
        }
    }
}

class NotificationPollReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        Notifications.handlePollBroadcast(this, context, intent)
    }
}
