package com.example.tv_guest_welcome

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.example.tv_guest_welcome.iptv.ImageLoader
import com.example.tv_guest_welcome.iptv.IptvDefaults
import com.example.tv_guest_welcome.iptv.IptvRepository
import com.example.tv_guest_welcome.iptv.M3uIptvProvider
import com.example.tv_guest_welcome.iptv.ui.CategoryAdapter
import com.example.tv_guest_welcome.iptv.ui.ChannelAdapter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class ChannelsActivity : AppCompatActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var categoriesList: RecyclerView
    private lateinit var channelsList: RecyclerView
    private lateinit var progress: ProgressBar
    private lateinit var refreshButton: Button
    private lateinit var titleText: TextView

    private var horizontalBrowseMode: Boolean = false
    private var initialFocusIndex: Int = 0
    private var returnToPlayer: Boolean = false

    private lateinit var repository: IptvRepository
    private lateinit var imageLoader: ImageLoader

    private lateinit var categoryAdapter: CategoryAdapter
    private lateinit var channelAdapter: ChannelAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        horizontalBrowseMode = intent.getBooleanExtra(EXTRA_HORIZONTAL_BROWSE, false)
        initialFocusIndex = intent.getIntExtra(EXTRA_FOCUS_INDEX, 0)
        returnToPlayer = intent.getBooleanExtra(EXTRA_RETURN_TO_PLAYER, false)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)

        setContentView(R.layout.activity_channels)

        categoriesList = findViewById(R.id.categories_list)
        channelsList = findViewById(R.id.channels_list)
        progress = findViewById(R.id.loading_progress)
        refreshButton = findViewById(R.id.refresh_button)
        titleText = findViewById(R.id.title_text)

        imageLoader = ImageLoader()

        val prefs = getSharedPreferences("IPTV_PREFS", Context.MODE_PRIVATE)
        val playlistUrl = prefs.getString("m3u_url", null)?.trim().orEmpty().ifEmpty { IptvDefaults.DEFAULT_M3U_URL }
        repository = IptvRepository(this, M3uIptvProvider(playlistUrl))

        categoryAdapter = CategoryAdapter { category ->
            channelAdapter.submit(category.channels)
            if (channelsList.adapter != null) {
                channelsList.scrollToPosition(0)
            }
        }
        channelAdapter = ChannelAdapter(scope, imageLoader, if (horizontalBrowseMode) 260 else null) { _, index ->
            val channels = ArrayList(channelAdapter.getChannels())
            IptvRepository.setPlaybackQueue(channels)

            if (returnToPlayer) {
                val intent = Intent(this, PlayerActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                intent.putExtra(PlayerActivity.EXTRA_START_INDEX, index)
                startActivity(intent)
                finish()
            } else {
                val intent = Intent(this, PlayerActivity::class.java)
                intent.putExtra(PlayerActivity.EXTRA_START_INDEX, index)
                startActivity(intent)
            }
        }

        categoriesList.layoutManager = LinearLayoutManager(this, RecyclerView.VERTICAL, false)
        categoriesList.adapter = categoryAdapter

        channelsList.layoutManager = if (horizontalBrowseMode) {
            LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        } else {
            GridLayoutManager(this, 2, RecyclerView.VERTICAL, false)
        }
        channelsList.adapter = channelAdapter

        if (!horizontalBrowseMode) {
            categoriesList.setOnKeyListener { _, keyCode, event ->
                if (event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
                when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        channelsList.requestFocus()
                        true
                    }
                    else -> false
                }
            }

            channelsList.setOnKeyListener { _, keyCode, event ->
                if (event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
                when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        categoriesList.requestFocus()
                        true
                    }
                    else -> false
                }
            }
        } else {
            categoriesList.visibility = View.GONE
            val lp = channelsList.layoutParams
            if (lp is android.view.ViewGroup.MarginLayoutParams) {
                lp.marginStart = 0
                channelsList.layoutParams = lp
            }
            titleText.text = "القنوات"
        }

        refreshButton.setOnClickListener { load(forceRefresh = true) }
        load(forceRefresh = false)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        Notifications.bindForeground(window) { }
        Notifications.pollAsync(this)
    }

    override fun onPause() {
        Notifications.unbindForeground()
        super.onPause()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            finish()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun load(forceRefresh: Boolean) {
        progress.visibility = View.VISIBLE
        scope.launch {
            try {
                val prefs = getSharedPreferences("IPTV_PREFS", Context.MODE_PRIVATE)
                val bad = if (IptvDefaults.FILTER_BAD_URLS) {
                    prefs.getStringSet("bad_urls", emptySet()).orEmpty()
                } else {
                    emptySet()
                }

                if (horizontalBrowseMode) {
                    val channels = repository.getChannels(forceRefresh)
                    val filteredChannels = if (bad.isEmpty()) channels else channels.filterNot { bad.contains(it.streamUrl) }
                    if (filteredChannels.isEmpty()) {
                        Toast.makeText(this@ChannelsActivity, "لا توجد قنوات", Toast.LENGTH_LONG).show()
                    }
                    channelAdapter.submit(filteredChannels)
                    val target = initialFocusIndex.coerceIn(0, (filteredChannels.size - 1).coerceAtLeast(0))
                    channelsList.post {
                        channelsList.scrollToPosition(target)
                        channelsList.requestFocus()
                        channelsList.findViewHolderForAdapterPosition(target)?.itemView?.requestFocus()
                    }
                } else {
                    val categories = repository.getCategories(forceRefresh)
                    val filtered = if (bad.isEmpty()) {
                        categories
                    } else {
                        categories.map { c -> c.copy(channels = c.channels.filterNot { bad.contains(it.streamUrl) }) }
                    }.filter { it.title == "الكل" || it.channels.isNotEmpty() }

                    if (filtered.isEmpty() || filtered.firstOrNull { it.title == "الكل" }?.channels.isNullOrEmpty()) {
                        Toast.makeText(this@ChannelsActivity, "لا توجد قنوات", Toast.LENGTH_LONG).show()
                    }
                    categoryAdapter.submit(filtered)
                    categoriesList.requestFocus()
                }
            } catch (t: Throwable) {
                Log.e("ChannelsActivity", "Failed to load channels", t)
                val details = t.message?.trim().orEmpty()
                val msg = if (details.isNotEmpty()) "فشل تحميل القنوات: $details" else "فشل تحميل القنوات"
                Toast.makeText(this@ChannelsActivity, msg, Toast.LENGTH_LONG).show()
            } finally {
                progress.visibility = View.GONE
            }
        }
    }

    companion object {
        const val EXTRA_HORIZONTAL_BROWSE = "extra_horizontal_browse"
        const val EXTRA_FOCUS_INDEX = "extra_focus_index"
        const val EXTRA_RETURN_TO_PLAYER = "extra_return_to_player"
    }
}
