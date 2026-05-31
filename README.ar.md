# masaken hotel — ترحيب Android TV + IPTV

هذا المشروع هو تطبيق يعمل على **Android TV / Fire TV / Xiaomi TV Stick** ويجمع بين:

1) صفحة ترحيب داخل **WebView** مستضافة على **GitHub Pages** (HTML/CSS/JS).
2) نظام **IPTV** داخل التطبيق (Media3/ExoPlayer) مع تحكم كامل عبر الريموت.
3) نظام **إشعارات** بسيط: صفحة إدارة → Supabase → أجهزة التلفزيون، ويظهر كالتالي:
   - فقاعة شفافة داخل صفحة الترحيب (الويب) لمدة 5 ثواني.
   - فقاعة شفافة داخل شاشات IPTV (القائمة + المشغل) لمدة 5 ثواني.
   - إشعار أندرويد عادي عندما التطبيق ليس في الواجهة.

الهدف: تجربة ترحيب للضيف تعمل على أجهزة التلفزيون بريموت **بدون أزرار أرقام**.

---

## روابط مهمة

- صفحة الترحيب (GitHub Pages): `https://esalahdal1.github.io/TV-Welcome/`
- صفحة الإدارة: `https://esalahdal1.github.io/TV-Welcome/?admin=1`
  - الرمز: `1234`
- تحميل APK مباشر (Release tag `latest`):
  - `https://github.com/esalahdal1/TV-Welcome-IPTV/releases/download/latest/app-debug.apk`

---

## التحكم بالريموت (DPAD)

داخل صفحة الترحيب (WebView):
- يعتمد على OK/Enter للتفاعل (بدون أزرار رقمية).

داخل مشغل IPTV:
- LEFT: القناة السابقة
- RIGHT / DOWN: القناة التالية
- UP: فتح “قائمة اختيار القنوات” (قائمة أفقية)
- OK: إظهار/إخفاء أدوات التحكم
- BACK: الخروج من المشغل

قائمة اختيار القنوات:
- يظهر مؤشر تحديد واضح (Focus) لتعرف أنت على أي قناة واقف.
- اختيار قناة من القائمة **لا يفتح مشغل جديد فوق مشغل**؛ يتم إعادة استخدام نفس شاشة المشغل.

---

## كيف يظهر اسم الضيف (مهم)

التطبيق نفسه (Kotlin) **لا يجلب اسم الضيف**.

صفحة الويب تقرأ رقم الغرفة من الرابط:

`https://.../TV-Welcome/?room=ROOM_NUMBER`

ثم تستعلم من Supabase:

- الجدول: `public.guests`
- الشرط: `room_number == room`
- العمود المستخدم: `full_name`

---

## Supabase: الجداول المطلوبة

بما أن صفحة الويب عامة (GitHub Pages)، فإن مفتاح Supabase داخل الصفحة يكون مكشوفًا، لذلك يجب ضبط **RLS** ليكون الوصول للبيانات محدودًا جدًا.

### A) جدول الضيوف (صفحة الترحيب)

- الجدول: `public.guests`
- الأعمدة المستخدمة:
  - `room_number` (text)
  - `full_name` (text)
- سكربت جاهز: `sql/supabase_guests_table_and_rls.sql`

### B) جدول الإشعارات (صفحة الإدارة → الأجهزة)

- الجدول: `public.tv_notifications`
- الأعمدة:
  - `room_number` (text, nullable)
    - `NULL` يعني إرسال للجميع
  - `message` (text)
  - `created_at` (timestamptz)

إن لم يكن موجودًا، أنشئه بهذا السكربت:

```sql
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tv_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  room_number text null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists tv_notifications_created_at_idx
  on public.tv_notifications (created_at);

alter table public.tv_notifications enable row level security;

drop policy if exists tv_notifications_select on public.tv_notifications;
create policy tv_notifications_select
  on public.tv_notifications
  for select
  using (true);

drop policy if exists tv_notifications_insert on public.tv_notifications;
create policy tv_notifications_insert
  on public.tv_notifications
  for insert
  with check (true);
```

---

## هيكل المشروع

### الويب (GitHub Pages)

- `index.html`
  - تصميم الترحيب والبراند.
  - ساعة بتوقيت الرياض + تاريخ هجري.
  - جلب اسم الضيف من Supabase.
  - حالة الطقس.
  - وضع الإدارة `?admin=1` مع رقم سري.
  - فقاعة إشعارات داخل الصفحة.

### تطبيق Android (Kotlin)

- `android/app/src/main/kotlin/com/example/tv_guest_welcome/MainActivity.kt`
  - يقرأ رقم الغرفة من `SharedPreferences` (`TV_PREFS`).
  - إن لم يوجد رقم: يفتح شاشة الإعداد.
  - إن وجد: يفتح GitHub Pages داخل WebView مع `?room=...`.
  - زر “تحديث” داخل التطبيق لتحميل أحدث APK من GitHub Releases وبدء التثبيت.

- `android/app/src/main/kotlin/com/example/tv_guest_welcome/SetupActivity.kt`
  - شاشة أول تشغيل: صلاحية overlay ثم إدخال رقم الغرفة وحفظه.

- IPTV
  - `QuickPlayActivity.kt`
  - `ChannelsActivity.kt`
  - `PlayerActivity.kt`
  - مجلد `iptv/` (تحميل M3U + parsing + cache + playback queue)

- الإشعارات
  - `Notifications.kt`
    - يسحب إشعارات جديدة من Supabase `tv_notifications`.
    - يعرض فقاعة فوق الشاشات الأصلية.
    - يعرض إشعار أندرويد إذا التطبيق ليس في الواجهة.

- التشغيل بعد الإقلاع (محاولة)
  - `BootReceiver.kt` + `ScreenService.kt`
  - ملاحظة: كثير من أجهزة Android TV/Android 14 تمنع فتح Activity من الخلفية (BAL)، ولا يوجد حل مضمون بدون صلاحيات نظام/لانشر.

---

## البناء والإصدارات (GitHub Actions)

الملف: `.github/workflows/android_build.yml`

- يبني `assembleRelease`
- يرفع APK إلى GitHub Releases تحت tag اسمه `latest`
- رابط التحميل ثابت:
  `.../releases/download/latest/app-debug.apk`

---

## التثبيت على Android TV / Fire Stick / Xiaomi Stick (أفضل طريقة)

بعض الأجهزة تفشل في “staged install” من Downloads/USB. أفضل طريقة:

```bash
adb devices
adb push app-debug.apk /data/local/tmp/masaken-hotel.apk
adb shell pm install -r /data/local/tmp/masaken-hotel.apk
```

### إذا ظهر خطأ اختلاف التوقيع

`INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`

الحل (يمسح بيانات التطبيق):

```bash
adb uninstall com.example.tv_guest_welcome
adb shell pm install /data/local/tmp/masaken-hotel.apk
```

للحفاظ على البيانات مع التحديثات، لازم استخدام keystore ثابت للتوقيع.

---

## استكشاف الأخطاء

- “التطبيق يقفل بعد حفظ رقم الغرفة”
  - كان بسبب crash في فقاعة الإشعار داخل الشاشات الأصلية وتم إصلاحه في `Notifications.kt`.

- “الطقس لا يظهر”
  - بعض مزودي الطقس يفشلون بسبب CORS داخل WebView. تم اعتماد مزود يعمل بدون API Key.

- “الإشعارات ما توصل”
  - تأكد جدول `tv_notifications` موجود و RLS يسمح `select` و `insert`.
  - تأكد الجهاز متصل بالإنترنت.

---

## قالب جاهز (ضعه في أي مساعد ذكاء اصطناعي ليعيد بناء التطبيق)

انسخ النص التالي والصقه في أي مساعد ذكاء اصطناعي.  
غيّر فقط الروابط/المفاتيح.

```text
أنت مهندس تطبيقات ومنتجات (Android TV + Web + Supabase). ابنِ مشروع يطابق هذا التطبيق تمامًا.

المدخلات:
1) رابط مستودع GitHub: <GITHUB_REPO_URL>
2) رابط مشروع Supabase: <SUPABASE_URL>
3) مفتاح Supabase anon/publishable: <SUPABASE_ANON_KEY>

المخرجات المطلوبة:
A) صفحة GitHub Pages (ملف index.html واحد) تحتوي:
   - واجهة ترحيب عربية لعلامة masaken hotel، ساعة بتوقيت الرياض + تاريخ هجري.
   - عنصر اسم الضيف (#guestName) يعرض “ضيفنا العزيز” إن لم يوجد room، وإلا يجلب الاسم من جدول `public.guests` عبر Supabase (full_name حسب room_number).
   - ويدجت طقس.
   - وضع إدارة عبر `?admin=1` محمي برقم سري 1234:
       * يعرض قائمة الشقق (رقم الشقة + اسم الضيف من guests).
       * زر “إرسال للكل” يضيف صفًا في `public.tv_notifications` بـ room_number = NULL.
       * زر لكل شقة يضيف صفًا في `public.tv_notifications` بـ room_number = رقم الغرفة.
   - عند استقبال إشعار والصفحة مفتوحة: فقاعة شفافة أعلى الصفحة لمدة 5 ثواني.

B) تطبيق Android TV (Kotlin) يحتوي:
   - شاشة إعداد لحفظ رقم الغرفة في SharedPreferences (TV_PREFS/room_number).
   - MainActivity يفتح GitHub Pages داخل WebView مع `?room=<room>`.
   - IPTV:
       * Down من صفحة الترحيب يشغل القناة رقم 1 مباشرة.
       * المشغل: DPAD LEFT/RIGHT (سابق/التالي)، UP يفتح قائمة اختيار القنوات، OK يظهر/يخفي أدوات التحكم.
       * قائمة اختيار القنوات فيها Focus واضح، واختيار قناة لا يفتح مشغل جديد فوق مشغل.
   - إشعارات:
       * يسحب من Supabase جدول `tv_notifications` ويعرض:
         - فقاعة داخل شاشات IPTV الأصلية 5 ثواني
         - إشعار أندرويد عادي إذا التطبيق ليس في الواجهة
       * إرسال “للجميع” يعمل حتى لو لم يتم إدخال رقم الغرفة بعد.
   - زر تحديث داخل التطبيق يحمل أحدث APK من GitHub Releases tag `latest` ويبدأ التثبيت.

قاعدة البيانات:
1) SQL لإنشاء `public.guests` مع RLS بحيث يسمح بقراءة room_number و full_name فقط.
2) SQL لإنشاء `public.tv_notifications` مع RLS يسمح insert/select بشكل مناسب.

قيود:
- واجهة مناسبة للريموت (بدون لمس).
- لا تعتمد على أزرار رقمية.
- لا تضع أي أسرار غير Supabase anon key.

معايير القبول:
- حفظ رقم الغرفة لا يسبب crash.
- الإشعارات تظهر في صفحة الترحيب وفي IPTV (القائمة + المشغل).
- اختيار قناة من القائمة لا يكدّس أكثر من مشغل.
```

