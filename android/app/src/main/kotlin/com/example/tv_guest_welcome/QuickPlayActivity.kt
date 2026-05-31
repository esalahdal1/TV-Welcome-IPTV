package com.example.tv_guest_welcome

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.tv_guest_welcome.iptv.IptvDefaults
import com.example.tv_guest_welcome.iptv.IptvRepository
import com.example.tv_guest_welcome.iptv.M3uIptvProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class QuickPlayActivity : AppCompatActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var progress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)

        setContentView(R.layout.activity_quick_play)
        progress = findViewById(R.id.quick_play_progress)

        val prefs = getSharedPreferences("IPTV_PREFS", Context.MODE_PRIVATE)
        val playlistUrl = prefs.getString("m3u_url", null)?.trim().orEmpty().ifEmpty { IptvDefaults.DEFAULT_M3U_URL }
        val repository = IptvRepository(this, M3uIptvProvider(playlistUrl))

        progress.visibility = View.VISIBLE
        scope.launch {
            try {
                val channels = repository.getChannels(forceRefresh = false)
                if (channels.isEmpty()) {
                    Toast.makeText(this@QuickPlayActivity, "لا توجد قنوات", Toast.LENGTH_LONG).show()
                    finish()
                    return@launch
                }

                val bad = if (IptvDefaults.FILTER_BAD_URLS) {
                    prefs.getStringSet("bad_urls", emptySet()).orEmpty()
                } else {
                    emptySet()
                }
                val filtered = if (bad.isEmpty()) channels else channels.filterNot { bad.contains(it.streamUrl) }
                if (filtered.isEmpty()) {
                    Toast.makeText(this@QuickPlayActivity, "لا توجد قنوات تعمل", Toast.LENGTH_LONG).show()
                    finish()
                    return@launch
                }

                IptvRepository.setPlaybackQueue(filtered)

                val intent = Intent(this@QuickPlayActivity, PlayerActivity::class.java)
                intent.putExtra(PlayerActivity.EXTRA_START_INDEX, 0)
                startActivity(intent)
                finish()
            } catch (t: Throwable) {
                Log.e("QuickPlayActivity", "Failed to load channels", t)
                val details = t.message?.trim().orEmpty()
                val msg = if (details.isNotEmpty()) "فشل تحميل القنوات: $details" else "فشل تحميل القنوات"
                Toast.makeText(this@QuickPlayActivity, msg, Toast.LENGTH_LONG).show()
                finish()
            } finally {
                progress.visibility = View.GONE
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
