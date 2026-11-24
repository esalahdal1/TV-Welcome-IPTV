# دليل التجهيز والتشغيل لأسطول شاشات مساكن النزهة (67 شاشة عبر ADB)

يغطي هذا الدليل نشر وإعداد تطبيق **masaken hotel (v3.0)** مع مستقبل البث **AirScreen** وتوزيع الغرف (58 شاشة) والصالات/الممرات (9 شاشات) دفعة واحدة دون الحاجة لإدخال يدوي بالريموت في كل غرفة.

---

## 1. المتطلبات المسبقة قبل النشر

1. **تطبيقات APK:**
   - تحميل أحدث `app-debug.apk` بعد دفع التحديثات إلى GitHub (يبنيه GitHub Actions تلقائيًا في `Releases/latest`).
   - *(اختياري لدعم AirPlay / iPhone Mirroring على شاشات Android TV غير المدعومة مصنعيًا)*: وضع ملف `airscreen.apk` في المسار `apk/airscreen.apk`.
2. **أداة ADB على جهاز الفني (Mac / Windows / Linux):**
   - على macOS: `brew install android-platform-tools`
3. **قاعدة بيانات Supabase:**
   - تشغيل ملفات SQL بالترتيب في لوحة Supabase:
     1. `sql/supabase_guests_table_and_rls.sql`
     2. `sql/supabase_tv_token_rpc.sql`
     3. `sql/supabase_stage2_room_pin_and_requests.sql`
     4. `sql/supabase_stage3_staff_security.sql`
4. **شبكة الشاشات وتثبيت الـ IP:**
   - يفضّل حجز DHCP Static Leases من راوتر الفندق لكل شاشة، وتفعيل **USB / Network Debugging (ADB)** من خيارات المطور في الشاشات أثناء التركيب (يفضّل إطفاء ADB أو عزله في VLAN الإدارة بعد انتهاء التركيب).

---

## 2. التجهيز التلقائي دفعة واحدة (غرف + صالات + AirScreen + صلاحيات)

تم توفير السكربت الجاهز `scripts/provision_tv.sh` مع قالب `scripts/tv_fleet.csv.example`:

### أ) تجهيز شاشة واحدة عبر الشبكة
- **شاشة غرفة (مثلاً غرفة 101):**
```bash
chmod +x scripts/provision_tv.sh
TVIP_APK=path/to/app-debug.apk AIRSCREEN_APK=path/to/airscreen.apk SET_LAUNCHER=1 \
  ./scripts/provision_tv.sh 192.168.10.101 room 101 http://192.168.10.50:8080/channels.m3u
```

- **شاشة صالة / ممر (`?mode=lobby`):**
```bash
TVIP_APK=path/to/app-debug.apk SET_LAUNCHER=1 \
  ./scripts/provision_tv.sh 192.168.10.201 lobby http://192.168.10.50:8080/channels.m3u
```

### ب) تجهيز الـ 67 شاشة كلها من جدول واحد (`CSV`)
1. انسخ `scripts/tv_fleet.csv.example` إلى `scripts/tv_fleet.csv` وأضف الـ 58 غرفة والـ 9 صالات.
2. نفّذ أمرًا واحدًا:
```bash
TVIP_APK=path/to/app-debug.apk AIRSCREEN_APK=path/to/airscreen.apk SET_LAUNCHER=1 \
  ./scripts/provision_tv.sh --csv scripts/tv_fleet.csv
```

ماذا ينفذ السكربت تلقائيًا لكل شاشة؟
1. يتصل عبر `adb connect <IP>:5555`.
2. يثبّت `masaken hotel` مع منحه الأذونات تلقائيًا (`POST_NOTIFICATIONS`, `SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES`, واستثناء البطارية `deviceidle whitelist`).
3. يثبّت `AirScreen` تلقائيًا (عند توفير `AIRSCREEN_APK`) ويمنحه صلاحيات الظهور والإشعارات والبطارية.
4. يضبط الواجهة الرئيسية (`HOME` launcher) على التطبيق عند تفعيل `SET_LAUNCHER=1`.
5. يرسل أمر الإعداد التلقائي إلى `SetupActivity` (`--es extra_mode ... --es extra_room ... --ez extra_auto_save true`) فتفتح الشاشة فورًا على بوابة الغرفة أو الصالة دون أي إدخال يدوي.

---

## 3. اختصارات الفني عن بُعد على التلفزيون

في حال رغبتك بتعديل غرفة أو تحديث يدوي من أمام التلفزيون:
- اضغط **زر Menu / Info** في الريموت، أو **اضغط مطوّلًا على زر الرجوع (BACK لمدة ثانية)** لفتح **قائمة الفني**:
  1. تغيير وضع الشاشة (غرفة / صالة) أو رقم الغرفة أو رابط قائمة M3U.
  2. فتح قائمة القنوات مباشرة.
  3. إعادة تحميل بوابة الويب مع مسح الكاش.
  4. التحقق من تحديث APK وتنزيله من GitHub Releases (`latest`).
  5. فتح إعدادات اللانشر / التطبيقات الافتراضية.

---

## 4. تشغيل البث الداخلي (Headend IPTV via HTTP)
- يدعم التطبيق ابتداءً من الإصدار `3.0` بروتوكول `http://` عبر الشبكة الداخلية للفندق (`network_security_config.xml` + `usesCleartextTraffic="true"`), ويمكن تحديد رابط `M3U` الخاص بالـ Headend من شاشة الإعداد أو من السكربت لكل شاشة.
- في حال انقطاع الإنترنت الخارجي عن الفندق: تظل شاشة الترحيب المحلية المدمجة (`offline_welcome.html`) مع مواعيد الـ Wi-Fi والاستقبال وتشغيل قنوات IPTV الداخلية تعمل بشكل طبيعي بالضغط على السهم للأسفل `▼`.
