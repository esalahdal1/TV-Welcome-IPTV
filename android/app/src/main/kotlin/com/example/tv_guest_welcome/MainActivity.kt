package com.example.tv_guest_welcome

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import kotlin.math.roundToInt
import java.io.File
import android.os.PowerManager

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var updateDownloadId: Long? = null
    private var updateReceiver: BroadcastReceiver? = null
    private var roomNumber: String? = null
    private var attemptedWelcomeFallback: Boolean = false
    @Volatile
    private var dpadDownBlockedByWeb: Boolean = false
    private var appsDialog: AlertDialog? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // تم إلغاء فحص الصلاحية يدوياً لتجنب تعليق الشاشات البسيطة
        // checkOverlayPermission()

        Notifications.ensurePostNotificationsPermission(this)
        Notifications.ensureScheduled(this)

        val prefs = getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
        roomNumber = prefs.getString("room_number", null)

        if (roomNumber == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        ensureBatteryOptimizationIgnoredOnce()

        // جعل النشاط يظهر فوق قفل الشاشة ويشغل الشاشة تلقائياً
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // إعدادات الشاشة الكاملة
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)

        setContentView(R.layout.activity_main_web)
        
        // ربط الـ WebView بالواجهة
        webView = findViewById(R.id.main_webview)
        webView.keepScreenOn = true
        val updateButton = findViewById<Button>(R.id.update_button)
        updateButton.setOnClickListener { downloadAndInstallUpdate() }
        
        // إعدادات الـ WebView لضمان السرعة والتحديث اللحظي
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportZoom(false)
        settings.displayZoomControls = false
        settings.builtInZoomControls = false
        
        // إجبار التطبيق على عدم استخدام التخزين المؤقت لضمان رؤية التحديثات الجديدة
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        webView.clearCache(true)
        
        // منع فتح الروابط في متصفح خارجي
        webView.addJavascriptInterface(IptvBridge(), "TVIP")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val scheme = uri.scheme?.lowercase()
                if (scheme == "http" || scheme == "https") {
                    view.loadUrl(uri.toString())
                }
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() }
                val scheme = uri?.scheme?.lowercase()
                if (scheme == "http" || scheme == "https") {
                    view?.loadUrl(url)
                }
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // شاشة كاملة عند تحميل الصفحة
                window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: android.webkit.WebResourceResponse?
            ) {
                val status = errorResponse?.statusCode ?: 0
                if (request?.isForMainFrame == true && status == 404) {
                    val url = request.url?.toString().orEmpty()
                    tryFallbackFromMissingPages(url)
                }
                super.onReceivedHttpError(view, request, errorResponse)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    val url = request.url?.toString().orEmpty()
                    tryFallbackFromMissingPages(url)
                }
                super.onReceivedError(view, request, error)
            }
        }

        // الرابط النهائي - يتم تحديثه تلقائياً من GitHub Pages
        val baseUrl = "https://esalahdal1.github.io/TV-Welcome-IPTV/"
        val finalUrl = buildWelcomeUrl(baseUrl)
        
        webView.loadUrl(finalUrl)
        webView.isFocusableInTouchMode = true
        webView.requestFocus()

        // تمت إزالة إغلاق التطبيق عند اللمس لدعم وضع الـ Kiosk
        // webView.setOnTouchListener { _, _ ->
        //    finish()
        //    true
        // }

    }

    override fun onDestroy() {
        updateReceiver?.let { unregisterReceiver(it) }
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
        if (event.action == KeyEvent.ACTION_DOWN && (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN || event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            val currentUrl = webView.url?.trim().orEmpty()
            val uri = runCatching { Uri.parse(currentUrl) }.getOrNull()
            val host = uri?.host?.lowercase().orEmpty()
            val path = uri?.path?.lowercase().orEmpty()

            val isWelcomePage = host == "esalahdal1.github.io" && (
                path.startsWith("/tv-welcome/") || path.startsWith("/tv-welcome-iptv/")
            )
            if (isWelcomePage && !dpadDownBlockedByWeb) {
                if (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                    startActivity(Intent(this, QuickPlayActivity::class.java))
                    return true
                }
                if (event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    showEntertainmentApps()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun showEntertainmentApps() {
        if (appsDialog?.isShowing == true) return
        val items = buildEntertainmentApps()
        if (items.isEmpty()) {
            Toast.makeText(this, "لا توجد تطبيقات ترفيه مثبتة", Toast.LENGTH_LONG).show()
            return
        }

        val listView = ListView(this)
        listView.divider = ColorDrawable(Color.parseColor("#22304A"))
        listView.dividerHeight = dpToPx(1)
        listView.isVerticalScrollBarEnabled = false
        listView.setBackgroundColor(Color.parseColor("#99000000"))
        listView.setPadding(dpToPx(12), dpToPx(20), dpToPx(12), dpToPx(20))

        val adapter = AppsAdapter(items)
        listView.adapter = adapter
        listView.setOnItemClickListener { _, _, position, _ ->
            val item = items.getOrNull(position) ?: return@setOnItemClickListener
            val launch = packageManager.getLaunchIntentForPackage(item.packageName)
            if (launch == null) {
                Toast.makeText(this, "التطبيق غير متاح", Toast.LENGTH_LONG).show()
                return@setOnItemClickListener
            }
            runCatching { startActivity(launch) }
            appsDialog?.dismiss()
        }

        val dialog = AlertDialog.Builder(this)
            .setView(listView)
            .create()

        dialog.setOnDismissListener { appsDialog = null }
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.show()
        dialog.window?.setLayout(dpToPx(420), ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.window?.setGravity(Gravity.END)

        listView.post {
            listView.requestFocus()
            listView.setSelection(0)
            listView.getChildAt(0)?.requestFocus()
        }

        appsDialog = dialog
    }

    private data class AppItem(
        val name: String,
        val packageName: String,
        val icon: Drawable
    )

    private data class AppCandidate(
        val name: String,
        val packages: List<String>
    )

    private fun buildEntertainmentApps(): List<AppItem> {
        val candidates = listOf(
            AppCandidate("نتفلكس", listOf("com.netflix.ninja", "com.netflix.mediaclient")),
            AppCandidate("شاهد", listOf("net.mbc.shahid", "net.mbc.shahid.tv")),
            AppCandidate("ابل تي في", listOf("com.apple.atve.androidtv.appletv", "com.apple.atve.androidtv")),
            AppCandidate("يوتيوب", listOf("com.google.android.youtube.tv", "com.google.android.youtube")),
            AppCandidate("برايم فيديو", listOf("com.amazon.amazonvideo.livingroom", "com.amazon.avod.thirdpartyclient"))
        )

        val out = ArrayList<AppItem>()
        for (c in candidates) {
            val pkg = c.packages.firstOrNull { p -> packageManager.getLaunchIntentForPackage(p) != null } ?: continue
            val icon = runCatching { packageManager.getApplicationIcon(pkg) }.getOrNull() ?: continue
            out.add(AppItem(name = c.name, packageName = pkg, icon = icon))
        }
        return out
    }

    private inner class AppsAdapter(
        private val items: List<AppItem>
    ) : BaseAdapter() {
        override fun getCount(): Int = items.size
        override fun getItem(position: Int): Any = items[position]
        override fun getItemId(position: Int): Long = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val row = convertView as? LinearLayout ?: LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = ListView.LayoutParams(ListView.LayoutParams.MATCH_PARENT, dpToPx(72))
                setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
                isFocusable = true
                isFocusableInTouchMode = true
                val iconView = ImageView(context).apply {
                    id = View.generateViewId()
                    layoutParams = LinearLayout.LayoutParams(dpToPx(42), dpToPx(42)).apply {
                        marginEnd = dpToPx(12)
                        gravity = Gravity.CENTER_VERTICAL
                    }
                }
                val textView = TextView(context).apply {
                    id = View.generateViewId()
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        gravity = Gravity.CENTER_VERTICAL
                    }
                    setTextColor(Color.parseColor("#EAF0FF"))
                    textSize = 18f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                }
                addView(iconView)
                addView(textView)
                background = makeRowBg(false)
                setOnFocusChangeListener { v, hasFocus ->
                    v.background = makeRowBg(hasFocus)
                    v.animate().scaleX(if (hasFocus) 1.04f else 1f).scaleY(if (hasFocus) 1.04f else 1f).setDuration(90).start()
                }
            }

            val item = items[position]
            val icon = row.getChildAt(0) as ImageView
            val text = row.getChildAt(1) as TextView
            icon.setImageDrawable(item.icon)
            text.text = item.name
            return row
        }

        private fun makeRowBg(focused: Boolean): Drawable {
            val bg = android.graphics.drawable.GradientDrawable()
            bg.cornerRadius = dpToPx(16).toFloat()
            bg.setColor(Color.parseColor(if (focused) "#22FBBF24" else "#1AFFFFFF"))
            bg.setStroke(dpToPx(1), Color.parseColor(if (focused) "#FBBF24" else "#22304A"))
            return bg
        }
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).roundToInt().coerceAtLeast(0)
    }

    private inner class IptvBridge {
        @JavascriptInterface
        fun setDpadDownBlocked(blocked: Boolean) {
            dpadDownBlockedByWeb = blocked
        }
    }

    private fun buildWelcomeUrl(baseUrl: String): String {
        val room = roomNumber?.trim().orEmpty()
        return if (room.isEmpty()) baseUrl else "$baseUrl?room=$room"
    }

    private fun tryFallbackFromMissingPages(loadedUrl: String) {
        if (attemptedWelcomeFallback) return
        if (!loadedUrl.contains("esalahdal1.github.io/TV-Welcome-IPTV", ignoreCase = true)) return
        attemptedWelcomeFallback = true
        val fallbackUrl = buildWelcomeUrl("https://esalahdal1.github.io/TV-Welcome/")
        Toast.makeText(this, "تعذر فتح صفحة الترحيب الجديدة (GitHub Pages). تم التحويل للرابط الاحتياطي.", Toast.LENGTH_LONG).show()
        webView.post { webView.loadUrl(fallbackUrl) }
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
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

        updateReceiver?.let { unregisterReceiver(it) }
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

    private fun installApk(apkFile: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivity(intent)
    }

    private fun ensureBatteryOptimizationIgnoredOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return

        val prefs = getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
        if (prefs.getBoolean("asked_ignore_battery_optimizations", false)) return
        prefs.edit().putBoolean("asked_ignore_battery_optimizations", true).apply()

        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) return

        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }
    }
}
