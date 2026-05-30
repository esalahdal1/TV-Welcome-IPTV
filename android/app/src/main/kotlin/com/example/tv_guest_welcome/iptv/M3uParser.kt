package com.example.tv_guest_welcome.iptv

class M3uParser {
    fun parse(text: String): List<Channel> {
        val lines = text.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toList()

        val channels = ArrayList<Channel>(lines.size / 2)

        var pendingName: String? = null
        var pendingLogo: String? = null
        var pendingGroup: String? = null

        for (line in lines) {
            if (line.startsWith("#EXTINF", ignoreCase = true)) {
                val commaIndex = line.lastIndexOf(',')
                val header = if (commaIndex >= 0) line.substring(0, commaIndex) else line
                val name = if (commaIndex >= 0) line.substring(commaIndex + 1).trim() else ""

                val attrs = parseAttributes(header)
                pendingName = if (name.isNotEmpty()) name else null
                pendingLogo = attrs["tvg-logo"]?.takeIf { it.isNotBlank() }
                pendingGroup = attrs["group-title"]?.takeIf { it.isNotBlank() }
                continue
            }

            if (line.startsWith("#")) continue

            val url = line
            val name = pendingName ?: url
            channels.add(
                Channel(
                    name = name,
                    streamUrl = url,
                    logoUrl = pendingLogo,
                    groupTitle = pendingGroup
                )
            )

            pendingName = null
            pendingLogo = null
            pendingGroup = null
        }

        return channels
    }

    private fun parseAttributes(header: String): Map<String, String> {
        val result = HashMap<String, String>()
        var i = 0
        while (i < header.length) {
            while (i < header.length && header[i].isWhitespace()) i++
            val keyStart = i
            while (i < header.length && header[i] != '=' && !header[i].isWhitespace()) i++
            if (i >= header.length || header[i] != '=') {
                i++
                continue
            }
            val key = header.substring(keyStart, i)
            i++
            if (i >= header.length) break
            val value: String
            if (header[i] == '"') {
                i++
                val valueStart = i
                while (i < header.length && header[i] != '"') i++
                value = header.substring(valueStart, i)
                if (i < header.length && header[i] == '"') i++
            } else {
                val valueStart = i
                while (i < header.length && !header[i].isWhitespace()) i++
                value = header.substring(valueStart, i)
            }
            if (key.isNotBlank()) result[key] = value
        }
        return result
    }
}

