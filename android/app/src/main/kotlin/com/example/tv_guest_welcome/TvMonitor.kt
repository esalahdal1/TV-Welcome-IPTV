package com.example.tv_guest_welcome

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object TvMonitor {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.SECONDS)
        .writeTimeout(3, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    @Volatile
    private var started = false

    @Volatile
    private var currentState: String = "portal"

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var mainRef: WeakReference<MainActivity>? = null

    fun onActivityResumed(activity: Activity, stateCode: String) {
        appContext = activity.applicationContext
        currentState = stateCode
        if (activity is MainActivity) {
            mainRef = WeakReference(activity)
        }
        ensureStarted()
        executor.execute { sendHeartbeatSafe() }
    }

    private fun ensureStarted() {
        if (started) return
        synchronized(this) {
            if (started) return
            started = true
            executor.scheduleWithFixedDelay(
                { sendHeartbeatSafe() },
                10L,
                12L,
                TimeUnit.SECONDS
            )
        }
    }

    private fun resolveDeviceId(prefs: android.content.SharedPreferences): String {
        val existing = prefs.getString("tv_device_id", null)?.trim().orEmpty()
        if (existing.isNotEmpty()) return existing
        val generated = "atv-" + UUID.randomUUID().toString().replace("-", "").take(10)
        prefs.edit().putString("tv_device_id", generated).apply()
        return generated
    }

    private fun findLocalIpv4(): String {
        return runCatching {
            val ifaces = NetworkInterface.getNetworkInterfaces()
            while (ifaces != null && ifaces.hasMoreElements()) {
                val nif = ifaces.nextElement()
                if (!nif.isUp || nif.isLoopback) continue
                val addrs = nif.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress.orEmpty()
                        if (ip.isNotEmpty() && !ip.startsWith("169.254.")) {
                            return@runCatching ip
                        }
                    }
                }
            }
            ""
        }.getOrDefault("")
    }

    private fun sendHeartbeatSafe() {
        val ctx = appContext ?: return
        runCatching {
            val prefs = ctx.getSharedPreferences(SetupActivity.PREFS_TV, Context.MODE_PRIVATE)
            val mode = prefs.getString(SetupActivity.KEY_APP_MODE, SetupActivity.MODE_ROOM)
                ?.trim()?.lowercase()?.ifEmpty { SetupActivity.MODE_ROOM }
                ?: SetupActivity.MODE_ROOM
            val room = prefs.getString(SetupActivity.KEY_ROOM_NUMBER, "")?.trim().orEmpty()
            val portalBase = ServerDiscovery.normalizePortalUrl(
                prefs.getString(SetupActivity.KEY_PORTAL_URL, SetupActivity.DEFAULT_PORTAL_URL)
            )
            if (portalBase.contains("github.io", ignoreCase = true)) return

            val versionName = runCatching {
                @Suppress("DEPRECATION")
                ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "3.5"
            }.getOrDefault("3.5")

            val payload = JSONObject().apply {
                put("room", if (mode == SetupActivity.MODE_LOBBY) "" else room)
                put("mode", mode)
                put("screen_state", currentState)
                put("app_version", versionName)
                put("platform", "android_tv")
                put("device_id", resolveDeviceId(prefs))
                put("local_ip", findLocalIpv4())
            }

            val req = Request.Builder()
                .url("${portalBase}api/tv/heartbeat")
                .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return
                val text = resp.body?.string().orEmpty()
                val json = JSONObject(text)
                val cmds = json.optJSONArray("commands") ?: return
                if (cmds.length() == 0) return
                for (i in 0 until cmds.length()) {
                    val cmd = cmds.optJSONObject(i)?.optString("command", "")?.trim().orEmpty()
                    if (cmd.isNotEmpty()) {
                        mainHandler.post { executeRemoteCommand(ctx, cmd) }
                    }
                }
            }
        }
    }

    private fun executeRemoteCommand(ctx: Context, command: String) {
        when (command) {
            "reload" -> {
                val main = mainRef?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }
                if (main != null && currentState in setOf("portal", "lobby")) {
                    main.runRemoteReload()
                } else {
                    val intent = Intent(ctx, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        putExtra(MainActivity.EXTRA_REMOTE_ACTION, "reload")
                    }
                    ctx.startActivity(intent)
                }
            }
            "open_tv" -> {
                val intent = Intent(ctx, QuickPlayActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(intent)
            }
            "open_portal" -> {
                val intent = Intent(ctx, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    putExtra(MainActivity.EXTRA_REMOTE_ACTION, "open_portal")
                }
                ctx.startActivity(intent)
            }
            "stop_cast" -> {
                mainRef?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }?.runRemoteStopCast()
            }
            "update_apk" -> {
                val main = mainRef?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }
                if (main != null && currentState in setOf("portal", "lobby")) {
                    main.runRemoteApkUpdate()
                } else {
                    val intent = Intent(ctx, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        putExtra(MainActivity.EXTRA_REMOTE_ACTION, "update_apk")
                    }
                    ctx.startActivity(intent)
                }
            }
        }
    }
}
