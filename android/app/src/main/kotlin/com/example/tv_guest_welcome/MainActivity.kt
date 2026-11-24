package com.example.tv_guest_welcome

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
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
import java.io.File

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var updateDownloadId: Long? = null
    private var updateReceiver: BroadcastReceiver? = null
    private var roomNumber: String? = null
    private var appMode: String = SetupActivity.MODE_ROOM
    private var customPortalBaseUrl: String? = null
    private var attemptedWelcomeFallback: Boolean = false
    private var loadedOfflineFallback: Boolean = false

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
        customPortalBaseUrl = prefs.getString(SetupActivity.KEY_PORTAL_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

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

        // عند توفر الإنترنت يستخدم LOAD_DEFAULT، وعند انقطاعه يستخدم الكاش ثم ينتقل للواجهة المدمجة عند الفشل
        webView.loadUrl(buildPrimaryWelcomeUrl())

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
        updateReceiver?.let { runCatching { unregisterReceiver(it) } }
        updateReceiver = null
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
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                backDownAtUptimeMs = SystemClock.uptimeMillis()
            } else if (event.action == KeyEvent.ACTION_UP && backDownAtUptimeMs > 0L) {
                val heldMs = SystemClock.uptimeMillis() - backDownAtUptimeMs
                backDownAtUptimeMs = 0L
                if (heldMs >= 900L) {
                    showTechnicianMenu()
                    return true
                }
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
        val path = uri.path?.lowercase().orEmpty()

        if (host == "esalahdal1.github.io" && (path.startsWith("/tv-welcome") || path.startsWith("/tv-welcome-iptv"))) {
            return true
        }
        val customHost = customPortalBaseUrl?.let { runCatching { Uri.parse(it).host?.lowercase() }.getOrNull() }
        return !customHost.isNullOrEmpty() && host == customHost
    }

    private fun launchLiveTv() {
        startActivity(Intent(this, QuickPlayActivity::class.java))
    }

    private fun launchChannelsGrid() {
        startActivity(Intent(this, ChannelsActivity::class.java))
    }

    private fun reloadOnlinePortal(clearCacheFirst: Boolean = false) {
        attemptedWelcomeFallback = false
        loadedOfflineFallback = false
        dpadDownBlockedByWeb = false
        webView.settings.cacheMode = if (isNetworkAvailable()) {
            WebSettings.LOAD_DEFAULT
        } else {
            WebSettings.LOAD_CACHE_ELSE_NETWORK
        }
        if (clearCacheFirst) {
            webView.clearCache(true)
        }
        webView.loadUrl(buildPrimaryWelcomeUrl())
    }

    private fun showTechnicianMenu() {
        val labelCurrent = if (appMode == SetupActivity.MODE_LOBBY) {
            "الوضع الحالي: شاشة صالة / ممر"
        } else {
            "الغرفة الحالية: ${roomNumber ?: "—"}"
        }
        val items = arrayOf(
            "إعدادات الغرفة / الصالة ورابط IPTV",
            "تصفح قائمة القنوات المباشرة",
            "إعادة تحميل البوابة (مسح الكاش)",
            "التحقق من تحديث التطبيق (APK)",
            "تعيين كلانشر / إعدادات النظام"
        )
        AlertDialog.Builder(this)
            .setTitle("قائمة الفني — $labelCurrent")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> startActivity(Intent(this, SetupActivity::class.java))
                    1 -> launchChannelsGrid()
                    2 -> reloadOnlinePortal(clearCacheFirst = true)
                    3 -> downloadAndInstallUpdate()
                    4 -> openHomeSettings()
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

        if (!attemptedWelcomeFallback && !loadedUrl.contains("esalahdal1.github.io/TV-Welcome/", ignoreCase = true)) {
            attemptedWelcomeFallback = true
            val fallbackUrl = buildWelcomeUrl(FALLBACK_PORTAL_URL)
            webView.post { webView.loadUrl(fallbackUrl) }
            return
        }

        if (!loadedOfflineFallback) {
            loadedOfflineFallback = true
            dpadDownBlockedByWeb = false
            val offlineUrl = buildOfflineAssetUrl()
            webView.post { webView.loadUrl(offlineUrl) }
        }
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
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

        val apkUrl = "https://github.com/esalahdal1/TV-Welcome-IPTV/releases/latest/download/app-debug.apk"
        val fileName = "masaken-hotel.apk"

        val request = DownloadManager.Request(Uri.parse(apkUrl))
            .setTitle("masaken hotel")
            .setDescription("تنزيل تحديث")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName)

        val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val downloadId = manager.enqueue(request)
        updateDownloadId = downloadId

        updateReceiver?.let { runCatching { unregisterReceiver(it) } }
        updateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent?) {
                val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: return
                if (id != downloadId) return

                val apkFile = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName)
                if (!apkFile.exists()) {
                    Toast.makeText(this@MainActivity, "فشل تنزيل التحديث", Toast.LENGTH_LONG).show()
                    return
                }
                installApk(apkFile)
            }
        }

        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(updateReceiver, filter)
        }

        Toast.makeText(this, "جارٍ تنزيل التحديث...", Toast.LENGTH_SHORT).show()
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
        private const val DEFAULT_PORTAL_URL = "https://esalahdal1.github.io/TV-Welcome-IPTV/"
        private const val FALLBACK_PORTAL_URL = "https://esalahdal1.github.io/TV-Welcome/"
        private const val OFFLINE_ASSET_URL = "file:///android_asset/offline_welcome.html"
    }
}
