package com.example.tv_guest_welcome.iptv

interface IptvProvider {
    suspend fun fetchChannels(): List<Channel>
}

