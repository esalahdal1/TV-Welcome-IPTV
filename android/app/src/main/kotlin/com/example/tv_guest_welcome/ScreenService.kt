package com.example.tv_guest_welcome

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

class ScreenService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var registered = false
    private var stopRunnable: Runnable? = null
    private var hasAttemptedLaunch = false

    private val triggerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: Intent?) {
            attemptLaunchOnce()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureForeground()
        ensureRegistered()
        scheduleStop()
        handler.postDelayed({ attemptLaunchOnce() }, 5000L)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (registered) {
            unregisterReceiver(triggerReceiver)
            registered = false
        }
        stopRunnable?.let { handler.removeCallbacks(it) }
        stopRunnable = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureRegistered() {
        if (registered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_USER_UNLOCKED)
        }
        registerReceiver(triggerReceiver, filter)
        registered = true
    }

    private fun scheduleStop() {
        stopRunnable?.let { handler.removeCallbacks(it) }
        stopRunnable = Runnable { stopSelf() }
        handler.postDelayed(stopRunnable!!, 30_000L)
    }

    private fun attemptLaunchOnce() {
        if (hasAttemptedLaunch) return
        hasAttemptedLaunch = true
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            ?: return
        runCatching { startActivity(launchIntent) }
        handler.postDelayed({ stopSelf() }, 3000L)
    }

    private fun ensureForeground() {
        val channelId = "masaken_boot"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(channelId, "masaken hotel", NotificationManager.IMPORTANCE_LOW)
            manager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("masaken hotel")
            .setContentText("تشغيل تلقائي")
            .setOngoing(true)
            .build()

        startForeground(1001, notification)
    }
}
