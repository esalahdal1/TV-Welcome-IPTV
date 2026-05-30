package com.example.tv_guest_welcome.iptv

data class Channel(
    val name: String,
    val streamUrl: String,
    val logoUrl: String? = null,
    val groupTitle: String? = null
)

