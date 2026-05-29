package com.example.tv_guest_welcome

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

class ScreenService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopSelf()
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
