package com.example.tv_guest_welcome.iptv

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class M3uIptvProvider(
    private val url: String,
    private val client: OkHttpClient = OkHttpClient(),
    private val parser: M3uParser = M3uParser()
) : IptvProvider {
    override suspend fun fetchChannels(): List<Channel> {
        val request = Request.Builder().url(url).build()
        val body = suspendCancellableCoroutine<String> { cont ->
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
                        val str = it.body?.string() ?: ""
                        cont.resume(str)
                    }
                }
            })
        }

        return parser.parse(body)
    }
}
