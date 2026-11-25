package com.example.tv_guest_welcome

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private var offlineRecoveryRunnable: Runnable? = null
    private var roomNumber: String? = null
    private var appMode: String = SetupActivity.MODE_ROOM
    private var customPortalBaseUrl: String? = null
    private var loadedOfflineFallback: Boolean = false

    @Volatile
    private var discoveryInFlight: Boolean = false
    @Volatile
    private var updateInFlight: Boolean = false

    @Volatile
    private var dpadDownBlockedByWeb: Boolean = false
    private var backDownAtUptimeMs: Long = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Notifications.ensurePostNotificationsPermission(this)
        Notifications.ensureScheduled(this)

        val prefs = getSharedPreferences(SetupActivity.PREFS_TV, Context.MODE_PRIVATE)
        appMode = prefs.getString(SetupActivity.KEY_APP_MODE, SetupActivity.MODE_ROOM)
            ?.trim()?.lowercase()?.ifEmpty { SetupActivity.MODE_ROOM }
            ?: SetupActivity.MODE_ROOM
        roomNumber = prefs.getString(SetupActivity.KEY_ROOM_NUMBER, null)?.trim()?.takeIf { it.isNotEmpty() }
        val savedPortal = prefs.getString(SetupActivity.KEY_PORTAL_URL, null)
            ?.trim()
            ?.takeIf { it.isNotEmpty() && !it.contains("github.io", ignoreCase = true) }
        customPortalBaseUrl = ServerDiscovery.normalizePortalUrl(savedPortal ?: DEFAULT_PORTAL_URL)
        if (savedPortal == null) {
            prefs.edit().putString(SetupActivity.KEY_PORTAL_URL, customPortalBaseUrl).apply()
        }

        val isConfigured = prefs.getBoolean(SetupActivity.KEY_IS_CONFIGURED, false) || !roomNumber.isNullOrEmpty()
        if (!isConfigured) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        ensureBatteryOptimizationIgnoredOnce()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        applyImmersiveUi()

        setContentView(R.layout.activity_main_web)

        webView = findViewById(R.id.main_webview)
        webView.keepScreenOn = true
        val updateButton = findViewById<Button>(R.id.update_button)
        updateButton.setOnClickListener { downloadAndInstallUpdate() }
        maybePromptSetAsHomeOnce()

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.setSupportZoom(false)
        settings.displayZoomControls = false
        settings.builtInZoomControls = false
        settings.cacheMode = if (isNetworkAvailable()) {
            WebSettings.LOAD_DEFAULT
        } else {
            WebSettings.LOAD_CACHE_ELSE_NETWORK
        }

        webView.addJavascriptInterface(IptvBridge(), "TVIP")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                return handleWebNavigationUri(view, uri)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return true
                return if (view != null) handleWebNavigationUri(view, uri) else true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                applyImmersiveUi()
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                val status = errorResponse?.statusCode ?: 0
                if (request?.isForMainFrame == true && status >= 400) {
                    tryFallbackFromMissingPages(request.url?.toString().orEmpty())
                }
                super.onReceivedHttpError(view, request, errorResponse)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    tryFallbackFromMissingPages(request.url?.toString().orEmpty())
                }
                super.onReceivedError(view, request, error)
            }

            @Deprecated("Deprecated in Java")
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    tryFallbackFromMissingPages(failingUrl.orEmpty())
                }
                @Suppress("DEPRECATION")
                super.onReceivedError(view, errorCode, description, failingUrl)
            }
        }

        // يفتح البوابة المحلية فوراً، ويتحقق بالخلفية لاكتشاف السيرفر تلقائياً إن تغير عنوانه
        webView.loadUrl(buildPrimaryWelcomeUrl())
        verifyCurrentOrDiscoverAsync()

        webView.isFocusableInTouchMode = true
        webView.requestFocus()
    }

    private fun handleWebNavigationUri(view: WebView, uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase().orEmpty()
        when (scheme) {
            "tvip" -> handleTvipUri(uri)
            "http", "https" -> view.loadUrl(uri.toString())
            "file" -> {
                if (uri.toString().startsWith(OFFLINE_ASSET_URL)) {
                    view.loadUrl(uri.toString())
                }
            }
        }
        return true
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
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

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                if (event.repeatCount == 0) {
                    backDownAtUptimeMs = SystemClock.uptimeMillis()
                }
                return true
            }
            if (event.action == KeyEvent.ACTION_UP) {
                val heldMs = if (backDownAtUptimeMs > 0L) (SystemClock.uptimeMillis() - backDownAtUptimeMs) else 0L
                backDownAtUptimeMs = 0L
                if (heldMs >= 900L) {
                    showTechnicianMenu()
                    return true
                }
                if (dpadDownBlockedByWeb) {
                    webView.evaluateJavascript(
                        "if (window.TVApp && TVApp.portal && TVApp.portal.handleNativeBack) TVApp.portal.handleNativeBack();",
                        null
                    )
                    return true
                }
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                    return true
                }
                // تجنّب الخروج العشوائي من واجهة الفندق عند ضغط BACK بالخطأ
                return true
            }
        }

        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            if (event.keyCode == KeyEvent.KEYCODE_MENU || event.keyCode == KeyEvent.KEYCODE_INFO) {
                showTechnicianMenu()
                return true
            }
            if (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN && !dpadDownBlockedByWeb && isWelcomePageVisible()) {
                launchLiveTv()
                return true
            }
        }

        return super.dispatchKeyEvent(event)
    }

    private fun isWelcomePageVisible(): Boolean {
        val currentUrl = webView.url?.trim().orEmpty()
        if (currentUrl.startsWith(OFFLINE_ASSET_URL)) return true
        val uri = runCatching { Uri.parse(currentUrl) }.getOrNull() ?: return false
        val host = uri.host?.lowercase().orEmpty()
        val activeBase = customPortalBaseUrl ?: DEFAULT_PORTAL_URL
        val activeHost = runCatching { Uri.parse(activeBase).host?.lowercase() }.getOrNull().orEmpty()
        return activeHost.isNotEmpty() && host == activeHost
    }

    private fun launchLiveTv() {
        startActivity(Intent(this, QuickPlayActivity::class.java))
    }

    private fun launchChannelsGrid() {
        startActivity(Intent(this, ChannelsActivity::class.java))
    }

    private fun reloadOnlinePortal(clearCacheFirst: Boolean = false) {
        loadedOfflineFallback = false
        dpadDownBlockedByWeb = false
        cancelOfflineRecovery()
        webView.settings.cacheMode = if (isNetworkAvailable()) {
            WebSettings.LOAD_DEFAULT
        } else {
            WebSettings.LOAD_CACHE_ELSE_NETWORK
        }
        if (clearCacheFirst) {
            webView.clearCache(true)
        }
        webView.loadUrl(buildPrimaryWelcomeUrl())
        verifyCurrentOrDiscoverAsync()
    }

    private fun showTechnicianMenu() {
        val labelCurrent = if (appMode == SetupActivity.MODE_LOBBY) {
            "الوضع الحالي: شاشة صالة / ممر"
        } else {
            "الغرفة الحالية: ${roomNumber ?: "—"}"
        }
        val items = arrayOf(
            "إعدادات الغرفة وعنوان السيرفر وIPTV",
            "البحث التلقائي عن السيرفر في الشبكة",
            "تصفح قائمة القنوات المباشرة",
            "إعادة تحميل البوابة (مسح الكاش)",
            "تحديث التطبيق من السيرفر المحلي (APK)",
            "تعيين كلانشر / إعدادات النظام"
        )
        AlertDialog.Builder(this)
            .setTitle("قائمة الفني — $labelCurrent")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> startActivity(Intent(this, SetupActivity::class.java))
                    1 -> {
                        Toast.makeText(this, "جارٍ البحث التلقائي عن سيرفر الفندق...", Toast.LENGTH_SHORT).show()
                        discoverAndRecoverServer(showOfflineOnFail = false, notifyEvenIfSame = true)
                    }
                    2 -> launchChannelsGrid()
                    3 -> reloadOnlinePortal(clearCacheFirst = true)
                    4 -> downloadAndInstallUpdate()
                    5 -> openHomeSettings()
                }
            }
            .setNegativeButton("إغلاق", null)
            .show()
    }

    private fun handleTvipUri(uri: Uri) {
        val actionHost = uri.host?.trim()?.lowercase().orEmpty()
        when (actionHost) {
            "tv", "iptv" -> {
                launchLiveTv()
                return
            }
            "channels" -> {
                launchChannelsGrid()
                return
            }
            "setup" -> {
                startActivity(Intent(this, SetupActivity::class.java))
                return
            }
            "reload" -> {
                reloadOnlinePortal(clearCacheFirst = false)
                return
            }
        }

        val id = uri.getQueryParameter("id")?.trim()?.lowercase().orEmpty()
        val pkgsRaw = uri.getQueryParameter("pkg")?.trim().orEmpty()

        val candidates = when (id) {
            "netflix" -> listOf("com.netflix.ninja", "com.netflix.mediaclient")
            "shahid" -> listOf("net.mbc.shahidTV", "net.mbc.shahid", "net.mbc.shahid.tv")
            "appletv" -> listOf("com.apple.atve.androidtv.appletv", "com.apple.atve.androidtv")
            "youtube" -> listOf("com.google.android.youtube.tv", "com.google.android.youtube")
            "prime" -> listOf("com.amazon.amazonvideo.livingroom", "com.amazon.avod.thirdpartyclient")
            else -> pkgsRaw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        }

        if (candidates.isEmpty()) {
            Toast.makeText(this, "التطبيق غير معروف", Toast.LENGTH_LONG).show()
            return
        }

        for (pkg in candidates) {
            val launch = getTvLaunchIntentForPackage(pkg)
            if (launch != null) {
                val ok = runCatching { startActivity(launch) }.isSuccess
                if (ok) return
            }
            if (tryLaunchTvAppPackage(pkg)) return
        }

        val isCastRequest = candidates.any { it.contains("airscreen", true) || it.contains("imirror", true) }
        val msg = if (isCastRequest) {
            "تطبيق استقبال البث (AirScreen) غير مثبت على هذه الشاشة بعد"
        } else {
            "التطبيق غير مثبت على هذه الشاشة"
        }
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    private fun tryLaunchTvAppPackage(packageName: String): Boolean {
        val leanback = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        try {
            startActivity(leanback)
            return true
        } catch (_: ActivityNotFoundException) {
        } catch (_: SecurityException) {
        }

        val launcher = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        return try {
            startActivity(launcher)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }

    private fun getTvLaunchIntentForPackage(packageName: String): Intent? {
        val pm = packageManager
        val main = Intent(Intent.ACTION_MAIN).setPackage(packageName)

        val leanback = Intent(main).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        val leanbackActivities = pm.queryIntentActivities(leanback, 0)
        val leanbackActivity = leanbackActivities.firstOrNull()?.activityInfo
        if (leanbackActivity != null) {
            return Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
                .setClassName(leanbackActivity.packageName, leanbackActivity.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        val launcher = Intent(main).addCategory(Intent.CATEGORY_LAUNCHER)
        val launcherActivities = pm.queryIntentActivities(launcher, 0)
        val launcherActivity = launcherActivities.firstOrNull()?.activityInfo
        if (launcherActivity != null) {
            return Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setClassName(launcherActivity.packageName, launcherActivity.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        return null
    }

    private inner class IptvBridge {
        @JavascriptInterface
        fun setDpadDownBlocked(blocked: Boolean) {
            dpadDownBlockedByWeb = blocked
        }

        @JavascriptInterface
        fun openLiveTv() {
            runOnUiThread { launchLiveTv() }
        }

        @JavascriptInterface
        fun openChannels() {
            runOnUiThread { launchChannelsGrid() }
        }

        @JavascriptInterface
        fun reloadPortal() {
            runOnUiThread { reloadOnlinePortal(clearCacheFirst = false) }
        }
    }

    private fun buildPrimaryWelcomeUrl(): String {
        val baseUrl = customPortalBaseUrl ?: DEFAULT_PORTAL_URL
        return buildWelcomeUrl(baseUrl)
    }

    private fun buildWelcomeUrl(baseUrl: String): String {
        val sep = if (baseUrl.contains("?")) "&" else "?"
        if (appMode == SetupActivity.MODE_LOBBY) {
            return "${baseUrl}${sep}mode=lobby"
        }
        val room = roomNumber?.trim().orEmpty()
        return if (room.isEmpty()) baseUrl else "${baseUrl}${sep}room=${Uri.encode(room)}"
    }

    private fun buildOfflineAssetUrl(): String {
        return buildWelcomeUrl(OFFLINE_ASSET_URL)
    }

    private fun tryFallbackFromMissingPages(loadedUrl: String) {
        if (loadedUrl.startsWith(OFFLINE_ASSET_URL)) return
        discoverAndRecoverServer(showOfflineOnFail = true, notifyEvenIfSame = false)
    }

    private fun verifyCurrentOrDiscoverAsync() {
        val activeBase = ServerDiscovery.normalizePortalUrl(customPortalBaseUrl ?: DEFAULT_PORTAL_URL)
        Thread {
            if (ServerDiscovery.isMasakenServer(activeBase, 1500L)) {
                return@Thread
            }
            discoverAndRecoverServer(showOfflineOnFail = true, notifyEvenIfSame = false)
        }.start()
    }

    private fun discoverAndRecoverServer(showOfflineOnFail: Boolean, notifyEvenIfSame: Boolean = false) {
        if (discoveryInFlight) return
        discoveryInFlight = true
        val previousBase = ServerDiscovery.normalizePortalUrl(customPortalBaseUrl ?: DEFAULT_PORTAL_URL)

        Thread {
            val found = try {
                ServerDiscovery.discoverServerUrl(applicationContext, previousBase)
            } finally {
                discoveryInFlight = false
            }

            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (!found.isNullOrEmpty()) {
                    val normalized = ServerDiscovery.normalizePortalUrl(found)
                    val changed = normalized != previousBase
                    if (changed) {
                        customPortalBaseUrl = normalized
                        getSharedPreferences(SetupActivity.PREFS_TV, Context.MODE_PRIVATE)
                            .edit()
                            .putString(SetupActivity.KEY_PORTAL_URL, normalized)
                            .apply()
                        Toast.makeText(
                            this,
                            "تم اكتشاف عنوان السيرفر تلقائياً: $normalized",
                            Toast.LENGTH_LONG
                        ).show()
                    } else if (notifyEvenIfSame) {
                        Toast.makeText(this, "السيرفر متصل ويعمل على: $normalized", Toast.LENGTH_SHORT).show()
                    }

                    if (changed || loadedOfflineFallback || notifyEvenIfSame) {
                        loadedOfflineFallback = false
                        dpadDownBlockedByWeb = false
                        cancelOfflineRecovery()
                        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
                        webView.loadUrl(buildPrimaryWelcomeUrl())
                    }
                } else {
                    if (notifyEvenIfSame) {
                        Toast.makeText(this, "تعذر العثور على السيرفر في الشبكة حالياً", Toast.LENGTH_LONG).show()
                    }
                    if (showOfflineOnFail && !loadedOfflineFallback) {
                        loadedOfflineFallback = true
                        dpadDownBlockedByWeb = false
                        webView.loadUrl(buildOfflineAssetUrl())
                    }
                    if (loadedOfflineFallback) {
                        scheduleOfflineRecovery()
                    }
                }
            }
        }.start()
    }

    private fun scheduleOfflineRecovery() {
        if (offlineRecoveryRunnable != null) return
        val runnable = object : Runnable {
            override fun run() {
                if (!loadedOfflineFallback || isFinishing || isDestroyed) {
                    offlineRecoveryRunnable = null
                    return
                }
                offlineRecoveryRunnable = null
                discoverAndRecoverServer(showOfflineOnFail = false, notifyEvenIfSame = false)
                if (loadedOfflineFallback && offlineRecoveryRunnable == null) {
                    offlineRecoveryRunnable = this
                    mainHandler.postDelayed(this, 12_000L)
                }
            }
        }
        offlineRecoveryRunnable = runnable
        mainHandler.postDelayed(runnable, 12_000L)
    }

    private fun cancelOfflineRecovery() {
        offlineRecoveryRunnable?.let { mainHandler.removeCallbacks(it) }
        offlineRecoveryRunnable = null
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }

    private fun applyImmersiveUi() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveUi()
        }
    }

    private fun downloadAndInstallUpdate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
            startActivity(intent)
            Toast.makeText(this, "فعّل السماح بتثبيت التطبيقات من هذا المصدر ثم اضغط تحديث مرة أخرى", Toast.LENGTH_LONG).show()
            return
        }
        if (updateInFlight) {
            Toast.makeText(this, "التحديث قيد التنزيل حالياً...", Toast.LENGTH_SHORT).show()
            return
        }

        updateInFlight = true
        Toast.makeText(this, "جارٍ تنزيل التحديث من السيرفر المحلي...", Toast.LENGTH_SHORT).show()
        val initialBase = ServerDiscovery.normalizePortalUrl(customPortalBaseUrl ?: DEFAULT_PORTAL_URL)

        Thread {
            var downloadedFile: File? = null
            var errorMessage = "تعذر العثور على ملف التحديث (/masaken.apk) على السيرفر"
            try {
                val activeBase = if (ServerDiscovery.isMasakenServer(initialBase, 1200L)) {
                    initialBase
                } else {
                    ServerDiscovery.discoverServerUrl(applicationContext, initialBase)?.also { found ->
                        val norm = ServerDiscovery.normalizePortalUrl(found)
                        customPortalBaseUrl = norm
                        getSharedPreferences(SetupActivity.PREFS_TV, Context.MODE_PRIVATE)
                            .edit()
                            .putString(SetupActivity.KEY_PORTAL_URL, norm)
                            .apply()
                    } ?: initialBase
                }

                val urls = listOf(
                    "${activeBase}masaken.apk",
                    "${activeBase}api/apk/download",
                    GITHUB_FALLBACK_APK_URL
                )
                val client = OkHttpClient.Builder()
                    .connectTimeout(5, TimeUnit.SECONDS)
                    .readTimeout(45, TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .build()

                val targetFile = File(cacheDir, "masaken-hotel.apk")
                val tempFile = File(cacheDir, "masaken-hotel.apk.tmp")

                for (candidateUrl in urls) {
                    val ok = runCatching {
                        val req = Request.Builder().url(candidateUrl).build()
                        client.newCall(req).execute().use { resp ->
                            if (!resp.isSuccessful) return@use false
                            val body = resp.body ?: return@use false
                            body.byteStream().use { input ->
                                FileOutputStream(tempFile).use { output ->
                                    input.copyTo(output, 65536)
                                }
                            }
                            tempFile.length() > 100_000L
                        }
                    }.getOrDefault(false)

                    if (ok) {
                        if (targetFile.exists()) targetFile.delete()
                        tempFile.renameTo(targetFile)
                        downloadedFile = targetFile
                        break
                    } else if (tempFile.exists()) {
                        tempFile.delete()
                    }
                }
            } catch (e: Exception) {
                errorMessage = "فشل تنزيل التحديث: ${e.localizedMessage ?: "خطأ بالشبكة"}"
            } finally {
                updateInFlight = false
            }

            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                val ready = downloadedFile
                if (ready != null && ready.exists()) {
                    installApk(ready)
                } else {
                    Toast.makeText(this, errorMessage, Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun maybePromptSetAsHomeOnce() {
        val prefs = getSharedPreferences(SetupActivity.PREFS_TV, Context.MODE_PRIVATE)
        if (prefs.getBoolean("asked_set_home_once", false)) return
        prefs.edit().putBoolean("asked_set_home_once", true).apply()
        if (isDefaultHomeApp()) return

        AlertDialog.Builder(this)
            .setTitle("تعيين كلانشر")
            .setMessage("لتشغيل التطبيق كواجهة رئيسية، اختر تعيين. للرجوع لقائمة الفني وإعدادات اللانشر اضغط مطوّلًا زر الرجوع أو زر Menu.")
            .setPositiveButton("تعيين") { _, _ -> openHomeSettings() }
            .setNegativeButton("لاحقاً", null)
            .show()
    }

    private fun isDefaultHomeApp(): Boolean {
        val homeIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.resolveActivity(
                homeIntent,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        }
        val pkg = resolved?.activityInfo?.packageName
        return pkg == packageName
    }

    private fun openHomeSettings() {
        val candidates = listOf(
            Intent("android.settings.HOME_SETTINGS"),
            Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS)
        )

        val opened = candidates.any { intent ->
            runCatching {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }.isSuccess
        }
        if (!opened) {
            Toast.makeText(this, "تعذر فتح الإعدادات", Toast.LENGTH_LONG).show()
        }
    }

    private fun installApk(apkFile: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivity(intent)
    }

    private fun ensureBatteryOptimizationIgnoredOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return

        val prefs = getSharedPreferences(SetupActivity.PREFS_TV, Context.MODE_PRIVATE)
        if (prefs.getBoolean("asked_ignore_battery_optimizations", false)) return
        prefs.edit().putBoolean("asked_ignore_battery_optimizations", true).apply()

        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) return

        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }
    }

    companion object {
        private const val DEFAULT_PORTAL_URL = SetupActivity.DEFAULT_PORTAL_URL
        private const val OFFLINE_ASSET_URL = "file:///android_asset/offline_welcome.html"
        private const val GITHUB_FALLBACK_APK_URL = "https://github.com/esalahdal1/TV-Welcome-IPTV/releases/latest/download/app-debug.apk"
    }
}
