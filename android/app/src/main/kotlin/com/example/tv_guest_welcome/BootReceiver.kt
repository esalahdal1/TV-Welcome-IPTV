package com.example.tv_guest_welcome

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        try {
            val action = intent?.action
            if (action == Intent.ACTION_BOOT_COMPLETED ||
                action == "android.intent.action.LOCKED_BOOT_COMPLETED" ||
                action == "android.intent.action.QUICKBOOT_POWERON") {
                val serviceIntent = Intent(context, ScreenService::class.java).setAction("BOOT_LAUNCH")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    @Suppress("DEPRECATION")
                    context.startService(serviceIntent)
                }
            }
        } catch (t: Throwable) {
            Log.e("BootReceiver", "Failed handling boot broadcast", t)
        }
    }
}
