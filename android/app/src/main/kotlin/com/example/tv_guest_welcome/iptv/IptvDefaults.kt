package com.example.tv_guest_welcome.iptv

import android.content.Context
import android.net.Uri
import com.example.tv_guest_welcome.SetupActivity

object IptvDefaults {
    const val DEFAULT_M3U_URL = "http://192.168.1.50/api/channels.m3u"
    const val FALLBACK_M3U_URL = "https://iptv-org.github.io/iptv/index.m3u"
    const val FILTER_BAD_URLS = false

    fun resolvePlaylistUrl(context: Context): String {
        val iptvPrefs = context.getSharedPreferences("IPTV_PREFS", Context.MODE_PRIVATE)
        val explicit = iptvPrefs.getString("m3u_url", null)?.trim().orEmpty()
        if (explicit.isNotEmpty()) return explicit

        val tvPrefs = context.getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
        val portal = tvPrefs.getString("portal_base_url", SetupActivity.DEFAULT_PORTAL_URL)
            ?.trim()
            ?.takeIf { it.isNotEmpty() && !it.contains("github.io", ignoreCase = true) }
            ?: SetupActivity.DEFAULT_PORTAL_URL
        if (portal.startsWith("http://", ignoreCase = true) || portal.startsWith("https://", ignoreCase = true)) {
            val uri = runCatching { Uri.parse(portal) }.getOrNull()
            val scheme = uri?.scheme?.lowercase().orEmpty()
            val auth = uri?.encodedAuthority.orEmpty()
            if (scheme.isNotEmpty() && auth.isNotEmpty()) {
                return "$scheme://$auth/api/channels.m3u"
            }
        }
        return DEFAULT_M3U_URL
    }
}
