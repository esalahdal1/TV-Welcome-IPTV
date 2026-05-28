package com.example.tv_guest_welcome

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

import android.content.pm.PackageManager
import android.view.KeyEvent
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import com.example.tv_guest_welcome.R

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // تم إلغاء فحص الصلاحية يدوياً لتجنب تعليق الشاشات البسيطة
        // checkOverlayPermission()

        val prefs = getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
        val roomNumber = prefs.getString("room_number", null)

        if (roomNumber == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

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
        }

        // الرابط النهائي - يتم تحديثه تلقائياً من GitHub Pages
        val baseUrl = "https://esalahdal1.github.io/TV-Welcome/" 
        val finalUrl = "$baseUrl?room=$roomNumber"
        
        webView.loadUrl(finalUrl)

        // تمت إزالة إغلاق التطبيق عند اللمس لدعم وضع الـ Kiosk
        // webView.setOnTouchListener { _, _ ->
        //    finish()
        //    true
        // }

        startService(Intent(this, ScreenService::class.java))
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

    private fun checkDefaultLauncher() {
        if (!isDefaultLauncher()) {
            AlertDialog.Builder(this)
                .setTitle("إعداد اللانشر الافتراضي")
                .setMessage("لضمان عدم خروج العميل من التطبيق، يرجى تعيين هذا التطبيق كواجهة رئيسية (Home App) واختيار 'دائماً'.")
                .setPositiveButton("تعيين الآن") { _, _ ->
                    val intent = Intent(Intent.ACTION_MAIN)
                    intent.addCategory(Intent.CATEGORY_HOME)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    startActivity(intent)
                }
                .setNegativeButton("لاحقاً", null)
                .show()
        }
    }

    private fun isDefaultLauncher(): Boolean {
        val intent = Intent(Intent.ACTION_MAIN)
        intent.addCategory(Intent.CATEGORY_HOME)
        val resolveInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))
        } else {
            @Suppress("DEPRECATION")
            packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }
        return resolveInfo?.activityInfo?.packageName == packageName
    }

    private fun checkOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "يرجى تفعيل صلاحية الظهور فوق التطبيقات الأخرى ليعمل التطبيق كشاشة توقف", Toast.LENGTH_LONG).show()
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            }
        }
    }
}
