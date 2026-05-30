package com.example.tv_guest_welcome.iptv

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class IptvRepository(
    private val context: Context,
    private val provider: IptvProvider,
    private val cacheTtlMs: Long = 6 * 60 * 60 * 1000L
) {
    private val cacheFile: File = File(context.filesDir, "iptv_channels_cache.json")

    suspend fun getChannels(forceRefresh: Boolean = false): List<Channel> = withContext(Dispatchers.IO) {
        if (!forceRefresh) {
            val cached = readCacheIfFresh()
            if (cached != null) return@withContext cached
        }

        try {
            val remote = provider.fetchChannels()
            if (remote.isNotEmpty()) {
                writeCache(remote)
            }
            return@withContext remote
        } catch (t: Throwable) {
            val fallback = readCache()
            if (fallback != null) return@withContext fallback
            throw t
        }
    }

    suspend fun getCategories(forceRefresh: Boolean = false): List<Category> {
        val channels = getChannels(forceRefresh)
        return buildCategories(channels)
    }

    private fun buildCategories(channels: List<Channel>): List<Category> {
        val groups = channels.groupBy { it.groupTitle?.trim().orEmpty().ifEmpty { "أخرى" } }
        val titles = groups.keys.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it })
        val categories = ArrayList<Category>(titles.size + 1)
        categories.add(Category(title = "الكل", channels = channels))
        for (title in titles) {
            categories.add(Category(title = title, channels = groups[title].orEmpty()))
        }
        return categories
    }

    private fun readCacheIfFresh(): List<Channel>? {
        if (!cacheFile.exists()) return null
        val text = runCatching { cacheFile.readText() }.getOrNull()?.trim().orEmpty()
        if (text.isEmpty()) return null
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
        val ts = json.optLong("ts", 0L)
        if (ts <= 0L) return null
        if (System.currentTimeMillis() - ts > cacheTtlMs) return null
        val arr = json.optJSONArray("channels") ?: return null
        return parseChannels(arr)
    }

    private fun readCache(): List<Channel>? {
        if (!cacheFile.exists()) return null
        val text = runCatching { cacheFile.readText() }.getOrNull()?.trim().orEmpty()
        if (text.isEmpty()) return null
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
        val arr = json.optJSONArray("channels") ?: return null
        return parseChannels(arr)
    }

    private fun writeCache(channels: List<Channel>) {
        val arr = JSONArray()
        for (c in channels) {
            val o = JSONObject()
            o.put("name", c.name)
            o.put("streamUrl", c.streamUrl)
            o.put("logoUrl", c.logoUrl)
            o.put("groupTitle", c.groupTitle)
            arr.put(o)
        }
        val root = JSONObject()
        root.put("ts", System.currentTimeMillis())
        root.put("channels", arr)
        cacheFile.writeText(root.toString())
    }

    private fun parseChannels(arr: JSONArray): List<Channel> {
        val out = ArrayList<Channel>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val name = o.optString("name", "").trim()
            val streamUrl = o.optString("streamUrl", "").trim()
            if (name.isEmpty() || streamUrl.isEmpty()) continue
            out.add(
                Channel(
                    name = name,
                    streamUrl = streamUrl,
                    logoUrl = o.optString("logoUrl", "").trim().ifEmpty { null },
                    groupTitle = o.optString("groupTitle", "").trim().ifEmpty { null }
                )
            )
        }
        return out
    }
}

