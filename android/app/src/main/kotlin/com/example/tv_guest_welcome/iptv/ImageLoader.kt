package com.example.tv_guest_welcome.iptv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.ImageView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request

class ImageLoader(
    private val client: OkHttpClient = OkHttpClient(),
    maxBytes: Int = 12 * 1024 * 1024
) {
    private val cache = object : LruCache<String, Bitmap>(maxBytes) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    private val inFlight = HashMap<ImageView, Job>()

    fun load(scope: CoroutineScope, url: String?, imageView: ImageView, placeholderRes: Int) {
        val safeUrl = url?.trim().orEmpty()
        if (safeUrl.isEmpty()) {
            imageView.setImageResource(placeholderRes)
            return
        }

        val cached = cache.get(safeUrl)
        if (cached != null) {
            imageView.setImageBitmap(cached)
            return
        }

        inFlight.remove(imageView)?.cancel()
        imageView.setImageResource(placeholderRes)

        var job: Job? = null
        job = scope.launch(Dispatchers.IO) {
            val request = Request.Builder().url(safeUrl).build()
            val bitmap = runCatching {
                client.newCall(request).execute().use { resp ->
                    if (!resp.isSuccessful) return@use null
                    val bytes = resp.body?.bytes() ?: return@use null
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }
            }.getOrNull()

            if (bitmap != null) {
                cache.put(safeUrl, bitmap)
                launch(Dispatchers.Main) {
                    if (inFlight[imageView] == job) {
                        imageView.setImageBitmap(bitmap)
                    }
                }
            }
        }

        inFlight[imageView] = job
    }
}
