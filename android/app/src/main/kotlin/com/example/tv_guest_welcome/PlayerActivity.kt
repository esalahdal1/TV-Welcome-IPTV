package com.example.tv_guest_welcome

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

class PlayerActivity : AppCompatActivity() {
    private lateinit var playerView: PlayerView
    private lateinit var overlay: TextView
    private var player: ExoPlayer? = null

    private val handler = Handler(Looper.getMainLooper())
    private var hideOverlayRunnable: Runnable? = null

    private var channelNames: ArrayList<String> = arrayListOf()
    private var channelUrls: ArrayList<String> = arrayListOf()
    private var currentIndex: Int = 0

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

        channelNames = intent.getStringArrayListExtra(EXTRA_CHANNEL_NAMES) ?: arrayListOf()
        channelUrls = intent.getStringArrayListExtra(EXTRA_CHANNEL_URLS) ?: arrayListOf()
        currentIndex = intent.getIntExtra(EXTRA_START_INDEX, 0).coerceIn(0, (channelUrls.size - 1).coerceAtLeast(0))

        player = ExoPlayer.Builder(this).build().also {
            playerView.player = it
        }
        playerView.useController = false

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
                if (channelUrls.isNotEmpty()) {
                    val next = (currentIndex - 1).coerceAtLeast(0)
                    if (next != currentIndex) playIndex(next)
                }
                return true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (channelUrls.isNotEmpty()) {
                    val next = (currentIndex + 1).coerceAtMost(channelUrls.size - 1)
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
        val url = channelUrls.getOrNull(index) ?: return
        val name = channelNames.getOrNull(index) ?: "قناة"

        val item = MediaItem.fromUri(url)
        player?.setMediaItem(item)
        player?.prepare()
        player?.playWhenReady = true

        showOverlay(name)
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
        const val EXTRA_CHANNEL_NAMES = "extra_channel_names"
        const val EXTRA_CHANNEL_URLS = "extra_channel_urls"
        const val EXTRA_START_INDEX = "extra_start_index"
    }
}
