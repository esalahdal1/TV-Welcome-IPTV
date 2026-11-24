package com.example.tv_guest_welcome

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SetupActivity : AppCompatActivity() {

    private lateinit var modeGroup: RadioGroup
    private lateinit var roomRadio: RadioButton
    private lateinit var lobbyRadio: RadioButton
    private lateinit var roomInputGroup: View
    private lateinit var roomInput: EditText
    private lateinit var m3uInput: EditText
    private lateinit var saveButton: Button
    private lateinit var overlayButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        Notifications.ensurePostNotificationsPermission(this)
        Notifications.ensureScheduled(this)

        modeGroup = findViewById(R.id.mode_radio_group)
        roomRadio = findViewById(R.id.mode_room_radio)
        lobbyRadio = findViewById(R.id.mode_lobby_radio)
        roomInputGroup = findViewById(R.id.room_input_group)
        roomInput = findViewById(R.id.room_number_input)
        m3uInput = findViewById(R.id.m3u_url_input)
        saveButton = findViewById(R.id.save_button)
        overlayButton = findViewById(R.id.overlay_perm_button)

        val prefs = getSharedPreferences(PREFS_TV, Context.MODE_PRIVATE)
        val iptvPrefs = getSharedPreferences(PREFS_IPTV, Context.MODE_PRIVATE)

        // دعم التجهيز التلقائي دفعة واحدة عبر ADB
        if (tryHandleAdbProvisionIntent(intent, prefs, iptvPrefs)) {
            return
        }

        val currentMode = intent.getStringExtra(EXTRA_MODE)?.trim()?.lowercase()
            ?: prefs.getString(KEY_APP_MODE, MODE_ROOM)
        val existingRoom = intent.getStringExtra(EXTRA_ROOM)?.trim()
            ?: prefs.getString(KEY_ROOM_NUMBER, "").orEmpty()
        val existingM3u = intent.getStringExtra(EXTRA_M3U_URL)?.trim()
            ?: iptvPrefs.getString(KEY_M3U_URL, "").orEmpty()

        if (currentMode == MODE_LOBBY) {
            lobbyRadio.isChecked = true
        } else {
            roomRadio.isChecked = true
        }
        roomInput.setText(existingRoom)
        m3uInput.setText(existingM3u)

        syncRoomVisibility()
        refreshOverlayButtonState()

        modeGroup.setOnCheckedChangeListener { _, _ ->
            syncRoomVisibility()
        }

        overlayButton.setOnClickListener {
            openOverlaySettings()
        }

        // فك القفل نهائياً: حقل الإدخال وزر الحفظ مفعّلان دائماً ولا يعتمدان على Overlay
        saveButton.isEnabled = true
        saveButton.setOnClickListener {
            val selectedMode = if (lobbyRadio.isChecked) MODE_LOBBY else MODE_ROOM
            val roomValue = roomInput.text.toString().trim()
            val m3uValue = m3uInput.text.toString().trim()

            if (selectedMode == MODE_ROOM && roomValue.isEmpty()) {
                Toast.makeText(this, "الرجاء إدخال رقم الغرفة أولاً", Toast.LENGTH_LONG).show()
                roomInput.requestFocus()
                return@setOnClickListener
            }

            saveConfiguration(
                prefs = prefs,
                iptvPrefs = iptvPrefs,
                mode = selectedMode,
                room = roomValue,
                m3uUrl = m3uValue,
                portalUrl = intent.getStringExtra(EXTRA_PORTAL_URL)?.trim()
            )
            launchMainAndFinish()
        }
    }

    override fun onResume() {
        super.onResume()
        Notifications.bindForeground(window) { }
        Notifications.pollAsync(this)
        refreshOverlayButtonState()
    }

    override fun onPause() {
        Notifications.unbindForeground()
        super.onPause()
    }

    private fun tryHandleAdbProvisionIntent(
        launchIntent: Intent?,
        prefs: android.content.SharedPreferences,
        iptvPrefs: android.content.SharedPreferences
    ): Boolean {
        if (launchIntent == null) return false
        val autoSave = launchIntent.getBooleanExtra(EXTRA_AUTO_SAVE, false)
        if (!autoSave) return false

        val modeRaw = launchIntent.getStringExtra(EXTRA_MODE)?.trim()?.lowercase().orEmpty()
        val roomRaw = launchIntent.getStringExtra(EXTRA_ROOM)?.trim().orEmpty()
        val mode = when {
            modeRaw == MODE_LOBBY -> MODE_LOBBY
            roomRaw.isNotEmpty() -> MODE_ROOM
            else -> return false
        }
        if (mode == MODE_ROOM && roomRaw.isEmpty()) return false

        val m3uRaw = launchIntent.getStringExtra(EXTRA_M3U_URL)?.trim()
        val portalRaw = launchIntent.getStringExtra(EXTRA_PORTAL_URL)?.trim()
        saveConfiguration(prefs, iptvPrefs, mode, roomRaw, m3uRaw, portalRaw)
        Toast.makeText(
            this,
            if (mode == MODE_LOBBY) "تم ضبط الشاشة على وضع الصالات" else "تم ضبط الغرفة $roomRaw",
            Toast.LENGTH_SHORT
        ).show()
        launchMainAndFinish()
        return true
    }

    private fun saveConfiguration(
        prefs: android.content.SharedPreferences,
        iptvPrefs: android.content.SharedPreferences,
        mode: String,
        room: String,
        m3uUrl: String?,
        portalUrl: String?
    ) {
        val tvEditor = prefs.edit()
            .putString(KEY_APP_MODE, mode)
            .putBoolean(KEY_IS_CONFIGURED, true)

        if (mode == MODE_LOBBY) {
            tvEditor.remove(KEY_ROOM_NUMBER)
        } else {
            tvEditor.putString(KEY_ROOM_NUMBER, room)
        }

        if (!portalUrl.isNullOrEmpty()) {
            tvEditor.putString(KEY_PORTAL_URL, portalUrl)
        }
        tvEditor.commit()

        val iptvEditor = iptvPrefs.edit()
        if (m3uUrl != null) {
            if (m3uUrl.isEmpty()) {
                iptvEditor.remove(KEY_M3U_URL)
            } else {
                iptvEditor.putString(KEY_M3U_URL, m3uUrl)
            }
            iptvEditor.commit()
        }
    }

    private fun launchMainAndFinish() {
        val mainIntent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(mainIntent)
        finish()
    }

    private fun syncRoomVisibility() {
        val isLobby = lobbyRadio.isChecked
        roomInputGroup.visibility = if (isLobby) View.GONE else View.VISIBLE
        roomInput.isEnabled = !isLobby
    }

    private fun refreshOverlayButtonState() {
        val granted = isOverlayGranted()
        if (granted) {
            overlayButton.text = "صلاحية الظهور: مفعّلة ✓"
            overlayButton.isEnabled = false
            overlayButton.isFocusable = false
        } else {
            overlayButton.text = "صلاحية الظهور (اختياري)"
            overlayButton.isEnabled = true
            overlayButton.isFocusable = true
        }
    }

    private fun isOverlayGranted(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return Settings.canDrawOverlays(this)
    }

    private fun openOverlaySettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }
            .onFailure {
                Toast.makeText(
                    this,
                    "شاشة السماح بالظهور غير متوفرة على هذا الطراز — يمكنك المتابعة بدونها",
                    Toast.LENGTH_LONG
                ).show()
            }
    }

    companion object {
        const val PREFS_TV = "TV_PREFS"
        const val PREFS_IPTV = "IPTV_PREFS"
        const val KEY_ROOM_NUMBER = "room_number"
        const val KEY_APP_MODE = "app_mode"
        const val KEY_IS_CONFIGURED = "is_configured"
        const val KEY_PORTAL_URL = "portal_base_url"
        const val KEY_M3U_URL = "m3u_url"

        const val MODE_ROOM = "room"
        const val MODE_LOBBY = "lobby"

        const val EXTRA_MODE = "extra_mode"
        const val EXTRA_ROOM = "extra_room"
        const val EXTRA_M3U_URL = "extra_m3u_url"
        const val EXTRA_PORTAL_URL = "extra_portal_url"
        const val EXTRA_AUTO_SAVE = "extra_auto_save"
    }
}
