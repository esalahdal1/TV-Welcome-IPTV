package com.example.tv_guest_welcome

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object ServerDiscovery {
    const val DEFAULT_SERVER_URL = "http://192.168.1.50/"
    const val MDNS_SERVER_URL = "http://masaken-tv.local/"
    private const val DISCOVERY_UDP_PORT = 8898
    private const val PROBE_MESSAGE = "MASAKEN_DISCOVER_V1"
    private const val SERVICE_SIGNATURE = "masaken-tvip"

    fun normalizePortalUrl(raw: String?): String {
        var s = raw?.trim().orEmpty()
        if (s.isEmpty()) return DEFAULT_SERVER_URL
        val qIdx = s.indexOf('?')
        if (qIdx >= 0) s = s.substring(0, qIdx).trim()
        val hIdx = s.indexOf('#')
        if (hIdx >= 0) s = s.substring(0, hIdx).trim()
        if (s.isEmpty()) return DEFAULT_SERVER_URL
        if (!s.startsWith("http://", ignoreCase = true) && !s.startsWith("https://", ignoreCase = true)) {
            s = "http://$s"
        }
        return if (s.endsWith("/")) s else "$s/"
    }

    private fun buildClient(timeoutMs: Long): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }

    fun isMasakenServer(baseUrl: String, timeoutMs: Long = 1000L): Boolean {
        val clean = normalizePortalUrl(baseUrl)
        if (clean.contains("github.io", ignoreCase = true)) return false
        val client = buildClient(timeoutMs)
        val req = Request.Builder()
            .url("${clean}api/health")
            .header("Accept", "application/json")
            .build()
        return runCatching {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use false
                val body = resp.body?.string().orEmpty()
                val json = JSONObject(body)
                val svc = json.optString("service", "")
                svc == SERVICE_SIGNATURE || (json.optBoolean("ok") && json.optString("mode") == "local")
            }
        }.getOrDefault(false)
    }

    fun discoverServerUrl(@Suppress("UNUSED_PARAMETER") context: Context, preferredUrl: String? = null): String? {
        val fastCandidates = LinkedHashSet<String>()
        if (!preferredUrl.isNullOrBlank() && !preferredUrl.contains("github.io", ignoreCase = true)) {
            fastCandidates.add(normalizePortalUrl(preferredUrl))
        }
        fastCandidates.add(DEFAULT_SERVER_URL)
        fastCandidates.add(MDNS_SERVER_URL)

        for (candidate in fastCandidates) {
            if (isMasakenServer(candidate, 850L)) {
                return candidate
            }
        }

        tryUdpBroadcastDiscovery()?.let { return it }
        return trySubnetSignatureSweep()
    }

    private fun tryUdpBroadcastDiscovery(): String? {
        val targets = LinkedHashSet<InetAddress>()
        runCatching { targets.add(InetAddress.getByName("255.255.255.255")) }
        runCatching {
            val ifaces = NetworkInterface.getNetworkInterfaces()
            while (ifaces != null && ifaces.hasMoreElements()) {
                val nif = ifaces.nextElement()
                if (!nif.isUp || nif.isLoopback) continue
                for (ia in nif.interfaceAddresses) {
                    val bcast = ia.broadcast
                    if (bcast is Inet4Address) {
                        targets.add(bcast)
                    }
                }
            }
        }

        return runCatching {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 240
                val payload = PROBE_MESSAGE.toByteArray(Charsets.UTF_8)

                repeat(2) {
                    for (target in targets) {
                        runCatching {
                            socket.send(DatagramPacket(payload, payload.size, target, DISCOVERY_UDP_PORT))
                        }
                    }
                    val buf = ByteArray(1024)
                    val deadline = System.currentTimeMillis() + 320L
                    while (System.currentTimeMillis() < deadline) {
                        val pkt = DatagramPacket(buf, buf.size)
                        val received = runCatching {
                            socket.receive(pkt)
                            true
                        }.getOrDefault(false)
                        if (!received) break

                        val ip = pkt.address?.hostAddress?.trim().orEmpty()
                        if (ip.isEmpty()) continue
                        val text = String(pkt.data, 0, pkt.length, Charsets.UTF_8)
                        val json = runCatching { JSONObject(text) }.getOrNull()
                        if (json?.optString("service") != SERVICE_SIGNATURE) continue

                        val port80 = "http://$ip/"
                        if (isMasakenServer(port80, 900L)) return@use port80

                        val directPort = json.optInt("direct_port", 8899)
                        val directUrl = "http://$ip:$directPort/"
                        if (isMasakenServer(directUrl, 900L)) return@use directUrl
                    }
                }
                null
            }
        }.getOrNull()
    }

    private fun collectLocalSubnets(): List<String> {
        val prefixes = LinkedHashSet<String>()
        runCatching {
            val ifaces = NetworkInterface.getNetworkInterfaces()
            while (ifaces != null && ifaces.hasMoreElements()) {
                val nif = ifaces.nextElement()
                if (!nif.isUp || nif.isLoopback) continue
                val addrs = nif.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val parts = addr.hostAddress.orEmpty().split('.')
                        if (parts.size == 4 && !addr.hostAddress.orEmpty().startsWith("169.254.")) {
                            prefixes.add("${parts[0]}.${parts[1]}.${parts[2]}")
                        }
                    }
                }
            }
        }
        prefixes.add("192.168.1")
        return prefixes.take(2)
    }

    private fun trySubnetSignatureSweep(): String? {
        val subnets = collectLocalSubnets()
        if (subnets.isEmpty()) return null

        val priorityHosts = listOf(50, 10, 100, 2, 200, 51, 49, 150, 101, 250, 1)
        val prioritySet = priorityHosts.toHashSet()
        val orderedHosts = priorityHosts + (1..254).filterNot { it in prioritySet }

        val winner = AtomicReference<String?>(null)
        val client = buildClient(450L)
        val pool = Executors.newFixedThreadPool(32)

        try {
            val futures = ArrayList<java.util.concurrent.Future<*>>(subnets.size * orderedHosts.size)
            for (prefix in subnets) {
                for (host in orderedHosts) {
                    futures.add(
                        pool.submit {
                            if (winner.get() != null) return@submit
                            val url = "http://$prefix.$host/"
                            val req = Request.Builder()
                                .url("${url}api/health")
                                .header("Accept", "application/json")
                                .build()
                            val matched = runCatching {
                                client.newCall(req).execute().use { resp ->
                                    if (!resp.isSuccessful) return@use false
                                    val json = JSONObject(resp.body?.string().orEmpty())
                                    json.optString("service") == SERVICE_SIGNATURE
                                }
                            }.getOrDefault(false)
                            if (matched && winner.compareAndSet(null, url)) {
                                pool.shutdownNow()
                            }
                        }
                    )
                }
            }
            pool.shutdown()
            pool.awaitTermination(3800L, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
        } finally {
            pool.shutdownNow()
        }
        return winner.get()
    }
}
