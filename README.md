# masaken hotel (TV Welcome)

تطبيق Android TV بسيط يعمل كغلاف WebView لعرض صفحة ترحيب مستضافة على GitHub Pages. تم تصميمه ليعمل مع أجهزة التلفاز والـ Fire Stick (ريموت بدون أرقام)، مع زر تحديث داخل التطبيق.

## فكرة التطبيق باختصار
- عند تشغيل التطبيق: يطلب صلاحية "الظهور فوق التطبيقات" في أول تشغيل (قبل إدخال رقم الغرفة).
- بعدها يطلب رقم الغرفة مرة واحدة ويحفظه.
- ثم يفتح صفحة الويب (GitHub Pages) مع تمرير رقم الغرفة في الرابط كـ query param.

## رابط الصفحة والرابط النهائي
- صفحة الويب: `https://esalahdal1.github.io/TV-Welcome/`
- داخل التطبيق يتم فتح:
  - `https://esalahdal1.github.io/TV-Welcome/?room=ROOM_NUMBER`

## كيف يظهر "اسم الضيف" الآن (المهم)
- التطبيق نفسه لا يجلب الاسم من Kotlin.
- اسم الضيف يتم جلبه داخل صفحة الويب [index.html](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/index.html) عبر Supabase JS:
  - يقرأ `room` من الرابط.
  - يستعلم من جدول Supabase اسمه `guests` ويقرأ عمود `full_name` بشرط `room_number = room`.

## طريقة عمل التطبيق (Android)
- [MainActivity](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/kotlin/com/example/tv_guest_welcome/MainActivity.kt)
  - يقرأ رقم الغرفة من `SharedPreferences` باسم `TV_PREFS` والمفتاح `room_number`.
  - إذا لم يوجد رقم غرفة: يفتح [SetupActivity](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/kotlin/com/example/tv_guest_welcome/SetupActivity.kt).
  - إذا وجد: يفتح WebView بالرابط النهائي، مع تعطيل الكاش لتحديث المحتوى فورًا.
  - زر "تحديث": ينزّل APK من GitHub Releases ويبدأ تثبيته عبر FileProvider.
- [SetupActivity](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/kotlin/com/example/tv_guest_welcome/SetupActivity.kt)
  - في أول تشغيل يفتح شاشة السماح بـ "الظهور فوق التطبيقات" (Overlay).
  - لا يسمح بإدخال رقم الغرفة إلا بعد تفعيل هذه الصلاحية.
- [BootReceiver](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/kotlin/com/example/tv_guest_welcome/BootReceiver.kt) + [ScreenService](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/kotlin/com/example/tv_guest_welcome/ScreenService.kt)
  - يستقبل BOOT_COMPLETED/LOCKED_BOOT_COMPLETED ويحاول تشغيل التطبيق.
  - ملاحظة مهمة: بعض الشاشات (خصوصًا Android 14/بعض Android TV) تمنع تشغيل الـ Activity تلقائيًا بعد الإقلاع بسبب سياسة النظام (BAL_BLOCK).

## واجهة الويب (GitHub Pages)
- الملف الرئيسي: [index.html](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/index.html)
- التخصيصات المتفق عليها:
  - اسم الحي: "النزهة".
  - الشعار: استخدام ملف PNG الموجود في المستودع.
  - الساعة: توقيت السعودية (Asia/Riyadh) وبصيغة 12 ساعة.
  - التحكم بالريموت: الاعتماد على OK/Enter بدل الأزرار الرقمية.

## Supabase (المشروع الحالي)
- Project URL: `https://ayfvvzawdbdcsiugazvn.supabase.co`
- المفتاح المستخدم في الويب (anon publishable):
  - `sb_publishable_V5a3JRO2UI371xQ-9MwT8w_J_8XT8Cm`
- ملاحظة أمنية: بما أن الصفحة مستضافة على GitHub Pages، أي مفتاح داخل HTML يعتبر مكشوف للعموم. لذلك لازم يكون الوصول للبيانات مضبوط بجدول بسيط و/أو RLS مناسب.

## طريقة إعداد Supabase لتعمل الصفحة (بدون أي تغيير في التطبيق)
- الجدول المطلوب للواجهة الحالية: `public.guests`
  - الأعمدة المطلوبة:
    - `room_number`
    - `full_name`
- SQL جاهز: الملف [supabase_guests_table_and_rls.sql](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/sql/supabase_guests_table_and_rls.sql)
  - انسخه والصقه في Supabase SQL Editor ثم Run.

## اختبار سريع من اللابتوب
افتح:
- `https://esalahdal1.github.io/TV-Welcome/?room=200`

إذا لم يظهر الاسم:
- تأكد من وجود صف في `public.guests` للغرفة 200.
- تأكد من RLS/Policy (الملف SQL أعلاه يجهزها).

## التحديث داخل التطبيق
- المصدر: GitHub Releases (tag: `latest`)
- رابط التحميل المباشر:
  - `https://github.com/esalahdal1/TV-Welcome/releases/latest/download/app-debug.apk`
- المتطلبات:
  - تفعيل "السماح بتثبيت التطبيقات من هذا المصدر" (Unknown Sources) للتطبيق.

## التثبيت على أجهزة TV / Fire Stick (أفضل طريقة)
بعض الشاشات تفشل في التثبيت بالطريقة العادية (Package Installer staging) خصوصًا من Download/USB. الطريقة الأكثر ثباتًا هي التثبيت من `/data/local/tmp`:

```bash
adb devices
adb push app-debug.apk /data/local/tmp/masaken-hotel.apk
adb shell pm install -r /data/local/tmp/masaken-hotel.apk
```

## ملاحظة مهمة عن "عدم التحديث" بسبب التوقيع
قد يظهر:
`INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`

السبب: التوقيع قد يختلف بين الإصدارات المبنية على CI. الحل الحالي عند حدوثه:

```bash
adb uninstall com.example.tv_guest_welcome
adb shell pm install /data/local/tmp/masaken-hotel.apk
```

إذا أردنا تحديثات بدون حذف (وتحافظ على رقم الغرفة)، لازم لاحقًا توحيد التوقيع عبر keystore ثابت في GitHub Actions.

## الاتفاقات التي اتفقنا عليها
- التطبيق "تطبيق عادي" (ليس Kiosk) ولا يمنع الخروج منه.
- الهدف: محاولة تشغيله تلقائيًا بعد الإقلاع بدون جعله Launcher، لكن بعض الأجهزة تمنع ذلك بنظامها (BAL_BLOCK) ولا يوجد حل مضمون 100% إلا بجعله Launcher أو بصلاحيات نظام.
- التطبيق يعمل مع ريموت Fire Stick / Xiaomi TV Stick بدون أزرار رقمية (OK/Back/Menu).
- وجود زر "تحديث" داخل التطبيق لتنزيل وتثبيت أحدث APK من GitHub.

## SQL Scripts داخل المشروع
- SQL المطلوب للواجهة الحالية (جدول guests + صلاحيات/سياسة قراءة): [supabase_guests_table_and_rls.sql](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/sql/supabase_guests_table_and_rls.sql)
- SQL خيار أكثر أمانًا (توكن + دالة RPC) غير مستخدم في الواجهة الحالية: [supabase_tv_token_rpc.sql](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/sql/supabase_tv_token_rpc.sql)

## ملفات مهمة
- Manifest: [AndroidManifest.xml](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/AndroidManifest.xml)
- إعدادات إصدار التطبيق: [build.gradle.kts](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/build.gradle.kts)
- أيقونة التطبيق: [masaken_icon.png](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/android/app/src/main/res/drawable/masaken_icon.png)
- سير عمل البناء والرفع: [android_build.yml](file:///Users/es/MRC%20LAPTOP/%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA/TVIP/.github/workflows/android_build.yml)
