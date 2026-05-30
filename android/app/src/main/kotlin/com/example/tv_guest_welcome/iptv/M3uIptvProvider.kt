package com.example.tv_guest_welcome.iptv

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class M3uIptvProvider(
    private val url: String,
    private val fallbackUrls: List<String> = listOf(IptvDefaults.FALLBACK_M3U_URL),
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build(),
    private val parser: M3uParser = M3uParser()
) : IptvProvider {
    override suspend fun fetchChannels(): List<Channel> {
        val urls = ArrayList<String>(1 + fallbackUrls.size)
        urls.add(url)
        for (u in fallbackUrls) {
            val trimmed = u.trim()
            if (trimmed.isNotEmpty() && trimmed != url) urls.add(trimmed)
        }

        var lastError: Throwable? = null
        for (candidate in urls) {
            try {
                val request = Request.Builder()
                    .url(candidate)
                    .header("User-Agent", "Mozilla/5.0")
                    .header("Accept", "*/*")
                    .build()

                val channels = suspendCancellableCoroutine<List<Channel>> { cont ->
                    val call = client.newCall(request)
                    cont.invokeOnCancellation { call.cancel() }
                    call.enqueue(object : Callback {
                        override fun onFailure(call: Call, e: IOException) {
                            if (cont.isCancelled) return
                            cont.resumeWithException(e)
                        }

                        override fun onResponse(call: Call, response: Response) {
                            response.use {
                                if (!it.isSuccessful) {
                                    cont.resumeWithException(IOException("HTTP ${it.code}"))
                                    return
                                }
                                val body = it.body
                                if (body == null) {
                                    cont.resume(emptyList())
                                    return
                                }
                                try {
                                    val reader = body.charStream().buffered()
                                    val parsed = parser.parseLines(reader.lineSequence())
                                    cont.resume(parsed)
                                } catch (t: Throwable) {
                                    cont.resumeWithException(t)
                                }
                            }
                        }
                    })
                }

                if (channels.isNotEmpty()) return channels
            } catch (t: Throwable) {
                lastError = t
            }
        }

        throw (lastError ?: IOException("Failed to load M3U"))
    }
}
