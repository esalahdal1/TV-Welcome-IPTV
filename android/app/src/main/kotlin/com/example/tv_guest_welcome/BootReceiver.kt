package com.example.tv_guest_welcome

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.LOCKED_BOOT_COMPLETED" ||
            action == "android.intent.action.QUICKBOOT_POWERON") {
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

            if (launchIntent != null) {
                scheduleLaunch(context, launchIntent)
            }
        }
    }

    private fun scheduleLaunch(context: Context, launchIntent: Intent) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            @Suppress("DEPRECATION")
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(context, 1001, launchIntent, flags)
        val triggerAt = System.currentTimeMillis() + 8000L

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
        } else {
            @Suppress("DEPRECATION")
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
        }
    }
}
