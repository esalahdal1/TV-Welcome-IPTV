package com.example.tv_guest_welcome

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.example.tv_guest_welcome.iptv.Channel
import com.example.tv_guest_welcome.iptv.IptvRepository

class PlayerActivity : AppCompatActivity() {
    private lateinit var playerView: PlayerView
    private lateinit var overlay: TextView
    private var player: ExoPlayer? = null

    private val handler = Handler(Looper.getMainLooper())
    private var hideOverlayRunnable: Runnable? = null

    private val channels: ArrayList<Channel> = arrayListOf()
    private var currentIndex: Int = 0
    private var skipOnErrorInProgress: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)

        setContentView(R.layout.activity_player)

        playerView = findViewById(R.id.player_view)
        overlay = findViewById(R.id.channel_overlay)

        val fromIntentNames = intent.getStringArrayListExtra(EXTRA_CHANNEL_NAMES)
        val fromIntentUrls = intent.getStringArrayListExtra(EXTRA_CHANNEL_URLS)
        val startIndexExtra = intent.getIntExtra(EXTRA_START_INDEX, 0)

        if (!fromIntentNames.isNullOrEmpty() && !fromIntentUrls.isNullOrEmpty() && fromIntentNames.size == fromIntentUrls.size) {
            for (i in 0 until fromIntentUrls.size) {
                val url = fromIntentUrls[i].trim()
                val name = fromIntentNames[i].trim().ifEmpty { "قناة" }
                if (url.isNotEmpty()) channels.add(Channel(name = name, streamUrl = url))
            }
        } else {
            val queue = IptvRepository.getPlaybackQueue().orEmpty()
            channels.addAll(queue)
        }

        filterKnownBadUrlsInPlace()
        if (channels.isEmpty()) {
            Toast.makeText(this, "لا توجد قنوات", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        currentIndex = startIndexExtra.coerceIn(0, (channels.size - 1).coerceAtLeast(0))

        player = ExoPlayer.Builder(this).build().also {
            playerView.player = it
        }
        playerView.useController = false
        player?.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                onPlaybackError()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    markGoodUrl(channels.getOrNull(currentIndex)?.streamUrl)
                }
            }
        })

        playIndex(currentIndex)
        playerView.requestFocus()
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        hideOverlayRunnable?.let { handler.removeCallbacks(it) }
        hideOverlayRunnable = null
        playerView.player = null
        player?.release()
        player = null
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                finish()
                return true
            }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_UP -> {
                if (channels.isNotEmpty()) {
                    val next = (currentIndex - 1).coerceAtLeast(0)
                    if (next != currentIndex) playIndex(next)
                }
                return true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (channels.isNotEmpty()) {
                    val next = (currentIndex + 1).coerceAtMost(channels.size - 1)
                    if (next != currentIndex) playIndex(next)
                }
                return true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                playerView.useController = !playerView.useController
                if (playerView.useController) {
                    playerView.showController()
                } else {
                    playerView.hideController()
                }
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun playIndex(index: Int) {
        currentIndex = index
        val item = channels.getOrNull(index) ?: return
        val url = item.streamUrl
        val name = item.name.ifEmpty { "قناة" }

        val mediaItem = MediaItem.fromUri(url)
        player?.setMediaItem(mediaItem)
        player?.prepare()
        player?.playWhenReady = true

        showOverlay(name)
    }

    private fun onPlaybackError() {
        if (skipOnErrorInProgress) return
        skipOnErrorInProgress = true

        val badUrl = channels.getOrNull(currentIndex)?.streamUrl
        markBadUrl(badUrl)
        if (badUrl != null) {
            channels.removeAll { it.streamUrl == badUrl }
        }

        if (channels.isEmpty()) {
            Toast.makeText(this, "لا توجد قنوات تعمل", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        if (currentIndex >= channels.size) {
            currentIndex = (channels.size - 1).coerceAtLeast(0)
        }

        showOverlay("تخطي قناة لا تعمل")
        handler.postDelayed({
            skipOnErrorInProgress = false
            playIndex(currentIndex)
        }, 500L)
    }

    private fun filterKnownBadUrlsInPlace() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val bad = prefs.getStringSet(PREF_BAD_URLS, emptySet()).orEmpty()
        if (bad.isEmpty()) return
        channels.removeAll { bad.contains(it.streamUrl) }
    }

    private fun markBadUrl(url: String?) {
        val safe = url?.trim().orEmpty()
        if (safe.isEmpty()) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getStringSet(PREF_BAD_URLS, emptySet()).orEmpty()
        if (existing.contains(safe)) return
        val updated = HashSet(existing)
        updated.add(safe)
        prefs.edit().putStringSet(PREF_BAD_URLS, updated).apply()
    }

    private fun markGoodUrl(url: String?) {
        val safe = url?.trim().orEmpty()
        if (safe.isEmpty()) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getStringSet(PREF_GOOD_URLS, emptySet()).orEmpty()
        if (existing.contains(safe)) return
        val updated = HashSet(existing)
        updated.add(safe)
        prefs.edit().putStringSet(PREF_GOOD_URLS, updated).apply()
    }

    private fun showOverlay(text: String) {
        overlay.text = text
        overlay.alpha = 1f
        overlay.visibility = View.VISIBLE
        hideOverlayRunnable?.let { handler.removeCallbacks(it) }
        hideOverlayRunnable = Runnable {
            overlay.animate().alpha(0f).setDuration(350).withEndAction {
                overlay.visibility = View.GONE
                overlay.alpha = 1f
            }.start()
        }
        handler.postDelayed(hideOverlayRunnable!!, 1800L)
    }

    companion object {
        private const val PREFS_NAME = "IPTV_PREFS"
        private const val PREF_BAD_URLS = "bad_urls"
        private const val PREF_GOOD_URLS = "good_urls"

        const val EXTRA_CHANNEL_NAMES = "extra_channel_names"
        const val EXTRA_CHANNEL_URLS = "extra_channel_urls"
        const val EXTRA_START_INDEX = "extra_start_index"
    }
}
