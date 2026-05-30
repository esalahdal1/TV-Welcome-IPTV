package com.example.tv_guest_welcome

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.tv_guest_welcome.R

class SetupActivity : AppCompatActivity() {
    private var overlaySettingsOpened = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        Notifications.ensurePostNotificationsPermission(this)
        Notifications.ensureScheduled(this)

        val input = findViewById<EditText>(R.id.room_number_input)
        val button = findViewById<Button>(R.id.save_button)

        val overlayGranted = isOverlayGranted()
        input.isEnabled = overlayGranted
        button.isEnabled = overlayGranted

        if (!overlayGranted) {
            openOverlaySettings()
        }

        button.setOnClickListener {
            val roomNumber = input.text.toString().trim()
            if (roomNumber.isNotEmpty()) {
                val prefs = getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
                prefs.edit().putString("room_number", roomNumber).apply()
                
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        Notifications.bindForeground(window) { }
        Notifications.pollAsync(this)
        val input = findViewById<EditText>(R.id.room_number_input)
        val button = findViewById<Button>(R.id.save_button)

        val overlayGranted = isOverlayGranted()
        input.isEnabled = overlayGranted
        button.isEnabled = overlayGranted

        if (!overlayGranted && overlaySettingsOpened) {
            Toast.makeText(this, "فعّل السماح بالظهور فوق التطبيقات ثم ارجع للتطبيق", Toast.LENGTH_LONG).show()
        }
    }

    private fun isOverlayGranted(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return Settings.canDrawOverlays(this)
    }

    private fun openOverlaySettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        overlaySettingsOpened = true
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }
            .onFailure {
                Toast.makeText(this, "لم يتم العثور على شاشة السماح بالظهور فوق التطبيقات في هذا الجهاز", Toast.LENGTH_LONG).show()
            }
    }

    override fun onPause() {
        Notifications.unbindForeground()
        super.onPause()
    }
}
