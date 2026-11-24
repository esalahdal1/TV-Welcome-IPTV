(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};

    var STRINGS = {
        ar: {
            pageTitle: 'مساكن النزهة - ترحيب النزلاء',
            hotelBrand: 'مساكن النزهة',
            companyName: 'شركة مساكن الرفاهية',
            companySub: 'MASAKEN ALRAFAHYA COMPANY',
            cityLabel: 'جدة - حي النزهة، المملكة العربية السعودية',
            greetingMorning: 'صباح الخير • مرحباً بك',
            greetingAfternoon: 'طاب يومك • مرحباً بك',
            greetingEvening: 'مساء الخير • مرحباً بك',
            defaultGuest: 'ضيفنا العزيز',
            roomLabel: 'رقم الغرفة',
            roomPinPillLabel: 'رمز التوصيل (PIN)',
            stayLabel: 'نتمنى لك',
            stayValue: 'إقامة مريحة',
            welcomeSub: 'يسعدنا جداً استضافتك، ونتمنى لك إقامة هادئة ومميزة في رحاب مساكن النزهة.',
            prayerHeader: 'مواقيت الصلاة — جدة',
            prayerNextPrefix: 'القادمة:',
            prayers: { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' },
            dock: {
                tvTitle: 'القنوات المباشرة',
                tvSub: 'اضغط ▼ للتشغيل',
                appsTitle: 'تطبيقات الترفيه',
                appsSub: 'شاهد • نتفلكس • يوتيوب',
                servicesTitle: 'خدمات الغرفة',
                servicesSub: 'تنظيف • صيانة • طلبات',
                castTitle: 'مشاركة الشاشة',
                castSub: 'جوال • لابتوب HDMI',
                guideTitle: 'دليل الفندق',
                guideSub: 'الواي فاي • الاستقبال',
                langTitle: 'English',
                langSub: 'تغيير اللغة'
            },
            remoteHintHtml: '<span>تنقل</span><span class="key-badge">◄ ►</span><span>فتح</span><span class="key-badge">OK</span><span>قنوات</span><span class="key-badge">▼</span><span>رجوع</span><span class="key-badge">BACK</span>',
            appsModalTitle: 'تطبيقات الترفيه',
            appsHint: 'أعلى/أسفل: تنقّل • OK: فتح التطبيق • رجوع: إغلاق',
            servicesModalTitle: 'خدمات وطلبات الغرفة',
            servicesNoteNoRoom: 'معاينة محلية: افتح الرابط برقم غرفة مثل ?room=101 لتفعيل إرسال الطلبات.',
            servicesSending: 'جارٍ إرسال الطلب للاستقبال...',
            servicesSent: 'تم إرسال طلبك بنجاح وسيتم خدمتك قريبًا',
            servicesErrorPrefix: 'تعذر إرسال الطلب: ',
            recentRequestsTitle: 'آخر طلبات الغرفة',
            recentRequestsEmpty: 'لا توجد طلبات مسجلة لهذه الغرفة بعد.',
            statusPending: 'قيد التنفيذ',
            statusDone: 'مكتمل',
            castModalTitle: 'مشاركة شاشة الجوال واللابتوب',
            castTabs: {
                webrtc: 'بث اللابتوب (WebRTC)',
                media: 'صور وفيديو (أي جوال)',
                airplay: 'iPhone / AirPlay',
                chromecast: 'Android / Chrome',
                hdmi: 'لابتوب HDMI (الأضمن)'
            },
            castPinLabel: 'رمز التوصيل للغرفة (PIN)',
            castDeviceLabel: 'اسم الشاشة:',
            castPinNote: 'امسح الـ QR Code بكاميرا الجوال لفتح بوابة الغرفة، ويتغيّر الـ PIN تلقائيًا عند تسجيل الخروج.',
            castQrScanTitle: 'امسح الكود لفتح بوابة الغرفة على جوالك أو اللابتوب',
            castPreviewMobileBtn: 'معاينة بوابة الضيف / بث اللابتوب',
            castLaunchReceiverBtn: 'فتح مستقبل البث (AirPlay / Cast)',
            castReceiverPreviewToast: 'على شاشة التلفزيون (تطبيق الأندرويد)، يفتح هذا الزر تطبيق استقبال البث المثبت (مثل AirScreen / iMirror).',
            castWebrtcWaiting: 'التلفزيون جاهز لاستقبال شاشة اللابتوب عبر المتصفح (WebRTC).',
            castMediaWaiting: 'التلفزيون جاهز لاستقبال الصور والفيديو من أي جوال بدون تثبيت تطبيقات.',
            castWebrtcActiveBanner: 'جارٍ عرض شاشة اللابتوب لاسلكياً • اضغط BACK لإيقاف العرض',
            castMediaActiveBanner: 'جارٍ عرض وسائط الجوال • اضغط BACK للإيقاف',
            castWebrtcStopBtn: 'إيقاف البث (BACK)',
            castSteps: {
                webrtc: [
                    'افتح الرابط الظاهر (أو امسح الـ QR Code) من متصفح Chrome أو Edge على اللابتوب.',
                    'في قسم «مشاركة الشاشة»، اضغط على زر «ابدأ مشاركة شاشة اللابتوب على التلفزيون».',
                    'اختر الشاشة أو النافذة المطلوبة — وستظهر هنا مباشرة لاسلكيًا حتى لو الواي فاي معزول!'
                ],
                media: [
                    'امسح الـ QR Code بكاميرا جوالك (iPhone أو Honor أو Samsung أو أي جوال).',
                    'من قسم «مشاركة الشاشة»، اختر تبويب «صور وفيديو (أي جوال)».',
                    'اختر صورة أو فيديو من جوالك ليُعرض فوراً على الشاشة بدون أي تطبيق إضافي!'
                ],
                airplay: [
                    'تأكد من اتصالك بشبكة الواي فاي الخاصة بالفندق (أو اضغط زر فتح مستقبل البث أدناه).',
                    'افتح مركز التحكم في الآيفون أو الآيباد واضغط على «انعكاس الشاشة / Screen Mirroring».',
                    'اختر شاشة غرفتك من القائمة ثم أدخل رمز التوصيل (PIN) إذا طُلب.'
                ],
                chromecast: [
                    'تأكد من اتصالك بشبكة الفندق على جوال الأندرويد أو متصفح Chrome في اللابتوب.',
                    'اضغط على أيقونة البث (Cast) داخل يوتيوب أو من قائمة Chrome ⋮ ← Cast.',
                    'اختر شاشة غرفتك للعرض مباشرة على التلفزيون.'
                ],
                hdmi: [
                    'استخدم كيبل HDMI الموجود بجانب مكتب الغرفة ووصّله بمنفذ اللابتوب.',
                    'من ريموت التلفزيون اضغط زر المدخلات (Input / Source) واختر مدخل HDMI المتاح.',
                    'مثالي لاجتماعات العمل والعروض بدقة كاملة وبدون أي تأخير في الشبكة.'
                ]
            },
            guideModalTitle: 'دليل الفندق ومعلومات الإقامة',
            guideQrLabel: 'امسح الكود لحفظ الواي فاي والخدمات على جوالك',
            guideLabels: {
                wifiName: 'اسم شبكة الواي فاي (Wi-Fi)',
                wifiPass: 'كلمة مرور الواي فاي',
                reception: 'تحويلة الاستقبال',
                breakfast: 'مواعيد الإفطار',
                checkout: 'موعد تسجيل المغادرة',
                address: 'الموقع',
                airport: 'مطار الملك عبدالعزيز (JED)'
            },
            lobby: {
                badge: 'صالة الضيوف — مساكن النزهة',
                slide1Tag: 'أهلاً بكم',
                slide1Title: 'مساكن النزهة للضيافة الفندقية',
                slide1Body: 'يسعدنا الترحيب بكم في رحاب مساكن النزهة بجدة — ضيافة عصرية هادئة، أجنحة مجهزة بالكامل، وخدمة ضيوف على مدار الساعة.',
                slide1Highlights: [
                    { icon: 'fa-concierge-bell', label: 'الاستقبال', val: 'خدمة 24 ساعة' },
                    { icon: 'fa-wifi', label: 'الإنترنت', val: 'Wi-Fi عالي السرعة' },
                    { icon: 'fa-tv', label: 'الترفيه', val: 'قنوات مباشرة ومنصات بث' }
                ],
                slide2Tag: 'معلومات الاتصال والواي فاي',
                slide2Title: 'تواصل فوري وإنترنت مجاني',
                slide2Body: 'اتصل بشبكة الواي فاي المجانية للفندق، أو تواصل مع مكتب الاستقبال لأي مساعدة على مدار اليوم.',
                websiteQrCaption: 'امسح الكود لزيارة الموقع الرسمي',
                slide3Tag: 'معلومات الإقامة والمطار',
                slide3Title: 'مواعيد الخدمات والموقع المميز',
                slide3Body: 'يقع الفندق في حي النزهة بمدينة جدة على مسافة قريبة من مطار الملك عبدالعزيز الدولي والمحاور الرئيسية.',
                airportDistance: 'قرب المطار • حي النزهة',
                slide4Tag: 'تنويه من إدارة الفندق',
                slide4Title: 'إعلان هام للضيوف',
                hintHtml: '<span>شرائح</span><span class="key-badge">◄ ►</span><span>اللغة</span><span class="key-badge">OK</span><span>قنوات</span><span class="key-badge">▼</span>'
            },
            mobile: {
                subtitle: 'بوابة خدمات الغرفة على جوالك',
                roomBadge: 'غرفة',
                pinGateTitle: 'تأكيد الدخول للغرفة',
                pinGateDesc: 'أدخل رمز الغرفة (PIN) المكون من 4 أرقام الظاهر على شاشة التلفزيون:',
                pinPlaceholder: 'مثال: 4821',
                pinSubmit: 'دخول للبوابة',
                pinInvalid: 'الرمز غير صحيح أو تغيّر بعد تسجيل الخروج. تحقق من شاشة التلفزيون.',
                wifiTitle: 'اتصال الواي فاي (Wi-Fi)',
                copyPass: 'نسخ كلمة المرور',
                copiedPass: 'تم النسخ!',
                servicesTitle: 'اطلب خدمة لغرفتك',
                historyTitle: 'متابعة طلباتك',
                castTitle: 'مشاركة الشاشة والتوصيل',
                guideTitle: 'معلومات الإقامة والاستقبال',
                changePinBtn: 'تغيير الغرفة / الرمز',
                webrtcStart: 'ابدأ مشاركة شاشة اللابتوب على التلفزيون',
                webrtcStop: 'إيقاف مشاركة الشاشة',
                webrtcConnecting: 'جارٍ الربط بشاشة الغرفة...',
                webrtcConnected: 'شاشتك معروضة الآن على تلفزيون الغرفة!',
                webrtcUnsupported: 'مشاركة شاشة سطح المكتب عبر المتصفح متاحة من اللابتوب (Chrome/Edge). لهواتف الآيفون وهونر والأندرويد استخدم تبويب «صور وفيديو (أي جوال)» أعلاه.',
                webrtcCancelled: 'تم إلغاء اختيار الشاشة.',
                webrtcFailed: 'تعذر بدء المشاركة. تأكد من فتح الغرفة على التلفزيون بنفس الـ PIN.',
                mediaPick: 'اختر صورة أو فيديو للعرض على التلفزيون',
                mediaPickAnother: 'عرض صورة أو فيديو آخر',
                mediaOptimizing: 'جارٍ تجهيز الصورة للعرض...',
                mediaUploading: 'جارٍ الإرسال إلى التلفزيون...',
                mediaPlaying: 'يُعرض الآن على تلفزيون الغرفة:',
                mediaPause: 'إيقاف مؤقت',
                mediaPlay: 'تشغيل',
                mediaMute: 'كتم الصوت',
                mediaUnmute: 'تشغيل الصوت',
                mediaStop: 'إيقاف العرض',
                mediaTooLarge: 'حجم الملف يتجاوز الحد المسموح (150 ميجابايت).',
                mediaUnsupported: 'يرجى اختيار صورة (JPG/PNG/HEIC) أو فيديو (MP4/MOV/WebM).',
                mediaUploadFailed: 'تعذر إرسال الملف إلى السيرفر المحلي.'
            },
            closeBtn: 'إغلاق (BACK)',
            tvIptvPreviewToast: 'على شاشة التلفزيون (تطبيق الأندرويد)، يفتح هذا الاختصار بث القنوات المباشرة فورًا.'
        },
        en: {
            pageTitle: 'Masaken Al-Nuzha - Guest Welcome',
            hotelBrand: 'MASAKEN AL-NUZHA',
            companyName: 'Masaken Alrafahya Company',
            companySub: 'MASAKEN ALRAFAHYA COMPANY',
            cityLabel: 'Jeddah - Al Nuzha District, Saudi Arabia',
            greetingMorning: 'Good Morning • Welcome',
            greetingAfternoon: 'Good Afternoon • Welcome',
            greetingEvening: 'Good Evening • Welcome',
            defaultGuest: 'Valued Guest',
            roomLabel: 'Room',
            roomPinPillLabel: 'Room PIN',
            stayLabel: 'We wish you',
            stayValue: 'A Pleasant Stay',
            welcomeSub: 'We are delighted to host you and wish you a calm and memorable stay at Masaken Al-Nuzha.',
            prayerHeader: 'Prayer Times — Jeddah',
            prayerNextPrefix: 'Next:',
            prayers: { Fajr: 'Fajr', Dhuhr: 'Dhuhr', Asr: 'Asr', Maghrib: 'Maghrib', Isha: 'Isha' },
            dock: {
                tvTitle: 'Live TV',
                tvSub: 'Press ▼ to watch',
                appsTitle: 'Streaming Apps',
                appsSub: 'Shahid • Netflix • YouTube',
                servicesTitle: 'Room Services',
                servicesSub: 'Housekeeping • Requests',
                castTitle: 'Screen Share',
                castSub: 'Phone • Laptop HDMI',
                guideTitle: 'Hotel Guide',
                guideSub: 'Wi-Fi • Reception Info',
                langTitle: 'العربية',
                langSub: 'Switch Language'
            },
            remoteHintHtml: '<span>Navigate</span><span class="key-badge">◄ ►</span><span>Select</span><span class="key-badge">OK</span><span>Live TV</span><span class="key-badge">▼</span><span>Close</span><span class="key-badge">BACK</span>',
            appsModalTitle: 'Entertainment Apps',
            appsHint: 'Up/Down: Navigate • OK: Launch • Back: Close',
            servicesModalTitle: 'In-Room Services & Requests',
            servicesNoteNoRoom: 'Preview mode: add ?room=101 to the URL to submit requests for a room.',
            servicesSending: 'Sending request to reception...',
            servicesSent: 'Your request has been received. Our team will assist you shortly.',
            servicesErrorPrefix: 'Failed to send request: ',
            recentRequestsTitle: 'Recent Room Requests',
            recentRequestsEmpty: 'No requests submitted for this room yet.',
            statusPending: 'Pending',
            statusDone: 'Completed',
            castModalTitle: 'Share Phone or Laptop Screen',
            castTabs: {
                webrtc: 'Laptop Wireless (WebRTC)',
                media: 'Photos & Video (Any Phone)',
                airplay: 'iPhone / AirPlay',
                chromecast: 'Android / Chrome',
                hdmi: 'Laptop HDMI (Direct)'
            },
            castPinLabel: 'Room Pairing PIN',
            castDeviceLabel: 'TV Name:',
            castPinNote: 'Scan the QR code with your phone to open the guest portal. PIN resets automatically on check-out.',
            castQrScanTitle: 'Scan QR to open your room portal on phone or laptop',
            castPreviewMobileBtn: 'Preview Guest Portal / Laptop Cast',
            castLaunchReceiverBtn: 'Open Cast Receiver (AirPlay / Cast)',
            castReceiverPreviewToast: 'On the Android TV app, this launches the installed receiver app (e.g. AirScreen / iMirror).',
            castWebrtcWaiting: 'TV is ready to receive your laptop screen via browser (WebRTC).',
            castMediaWaiting: 'TV is ready to display photos & videos directly from any phone browser.',
            castWebrtcActiveBanner: 'Wireless Laptop Screen Active • Press BACK to stop',
            castMediaActiveBanner: 'Mobile Media Casting • Press BACK to stop',
            castWebrtcStopBtn: 'Stop Casting (BACK)',
            castSteps: {
                webrtc: [
                    'Open this room portal URL (or scan the QR code) in Chrome or Edge on your laptop.',
                    'Under Screen Casting, click "Start Sharing Laptop Screen".',
                    'Choose your screen or window — it streams straight to the TV even on isolated hotel Wi-Fi!'
                ],
                media: [
                    'Scan the QR code using your phone camera (iPhone, Honor, Samsung, or any phone).',
                    'Select the "Photos & Video (Any Phone)" tab in Screen Casting.',
                    'Pick any photo or video from your gallery to display it instantly on the TV!'
                ],
                airplay: [
                    'Connect your iPhone or iPad to the hotel Wi-Fi (or click Open Cast Receiver below).',
                    'Open Control Center and tap "Screen Mirroring".',
                    'Select your room TV and enter the pairing PIN if prompted.'
                ],
                chromecast: [
                    'Connect your Android phone or laptop Chrome browser to the hotel Wi-Fi.',
                    'Tap the Cast icon in YouTube/apps, or in Chrome menu ⋮ → Cast.',
                    'Select your room TV to start streaming.'
                ],
                hdmi: [
                    'Plug the HDMI cable located near the room desk into your laptop.',
                    'Press Input / Source on the TV remote and choose the active HDMI port.',
                    'Recommended for business presentations and zero-latency screen sharing.'
                ]
            },
            guideModalTitle: 'Hotel Directory & Wi-Fi',
            guideQrLabel: 'Scan QR to keep Wi-Fi & services on your phone',
            guideLabels: {
                wifiName: 'Wi-Fi Network',
                wifiPass: 'Wi-Fi Password',
                reception: 'Reception Extension',
                breakfast: 'Breakfast Hours',
                checkout: 'Check-out Time',
                address: 'Location',
                airport: 'King Abdulaziz Airport (JED)'
            },
            lobby: {
                badge: 'Guest Lounge — Masaken Al-Nuzha',
                slide1Tag: 'Welcome',
                slide1Title: 'Masaken Al-Nuzha Hospitality',
                slide1Body: 'Welcome to Masaken Al-Nuzha in Jeddah — refined comfort, fully equipped suites, and 24/7 guest hospitality.',
                slide1Highlights: [
                    { icon: 'fa-concierge-bell', label: 'Reception', val: '24/7 Service' },
                    { icon: 'fa-wifi', label: 'Internet', val: 'High-Speed Wi-Fi' },
                    { icon: 'fa-tv', label: 'Entertainment', val: 'Live TV & Streaming' }
                ],
                slide2Tag: 'Wi-Fi & Front Desk',
                slide2Title: 'Stay Connected Anytime',
                slide2Body: 'Join our complimentary hotel Wi-Fi or contact our front desk team whenever you need assistance.',
                websiteQrCaption: 'Scan QR for official website',
                slide3Tag: 'Stay Schedule & Location',
                slide3Title: 'Services & Airport Proximity',
                slide3Body: 'Ideally situated in Al-Nuzha District, Jeddah with fast access to King Abdulaziz International Airport (JED).',
                airportDistance: 'Near JED Airport • Al-Nuzha',
                slide4Tag: 'Hotel Notice',
                slide4Title: 'Guest Announcement',
                hintHtml: '<span>Slides</span><span class="key-badge">◄ ►</span><span>Language</span><span class="key-badge">OK</span><span>Live TV</span><span class="key-badge">▼</span>'
            },
            mobile: {
                subtitle: 'Your In-Room Mobile Portal',
                roomBadge: 'Room',
                pinGateTitle: 'Verify Room Access',
                pinGateDesc: 'Enter the 4-digit Room PIN shown on your room TV screen:',
                pinPlaceholder: 'e.g. 4821',
                pinSubmit: 'Enter Portal',
                pinInvalid: 'Invalid PIN or session expired after check-out. Please check your TV screen.',
                wifiTitle: 'Hotel Wi-Fi',
                copyPass: 'Copy Password',
                copiedPass: 'Copied!',
                servicesTitle: 'Request Room Service',
                historyTitle: 'Your Requests Status',
                castTitle: 'Screen Casting & HDMI',
                guideTitle: 'Stay & Reception Info',
                changePinBtn: 'Switch Room / PIN',
                webrtcStart: 'Start Sharing Laptop Screen',
                webrtcStop: 'Stop Screen Sharing',
                webrtcConnecting: 'Connecting to room TV...',
                webrtcConnected: 'Your laptop screen is now live on the room TV!',
                webrtcUnsupported: 'Desktop screen capture works from a laptop browser (Chrome/Edge over HTTPS). On iPhone, Honor, or Android phones, use the "Photos & Video (Any Phone)" tab above.',
                webrtcCancelled: 'Screen selection was cancelled.',
                webrtcFailed: 'Could not connect. Make sure the room TV screen is open with the same PIN.',
                mediaPick: 'Choose Photo or Video for TV',
                mediaPickAnother: 'Cast Another Photo or Video',
                mediaOptimizing: 'Preparing photo for TV...',
                mediaUploading: 'Sending to room TV...',
                mediaPlaying: 'Now showing on room TV:',
                mediaPause: 'Pause',
                mediaPlay: 'Play',
                mediaMute: 'Mute',
                mediaUnmute: 'Unmute',
                mediaStop: 'Stop Casting',
                mediaTooLarge: 'File size exceeds the 150 MB limit.',
                mediaUnsupported: 'Please pick an image (JPG/PNG/HEIC) or video (MP4/MOV/WebM).',
                mediaUploadFailed: 'Could not upload file to local server.'
            },
            closeBtn: 'Close (BACK)',
            tvIptvPreviewToast: 'On the Android TV app, this launches Live IPTV channels immediately.'
        }
    };

    var WEATHER_LABELS = {
        0: { ar: 'سماء صافية', en: 'Clear Sky' },
        1: { ar: 'صافي غالباً', en: 'Mainly Clear' },
        2: { ar: 'غائم جزئياً', en: 'Partly Cloudy' },
        3: { ar: 'غائم', en: 'Overcast' },
        45: { ar: 'ضباب', en: 'Fog' },
        48: { ar: 'ضباب خفيف', en: 'Depositing Fog' },
        51: { ar: 'رذاذ خفيف', en: 'Light Drizzle' },
        53: { ar: 'رذاذ متوسط', en: 'Moderate Drizzle' },
        55: { ar: 'رذاذ كثيف', en: 'Dense Drizzle' },
        61: { ar: 'أمطار خفيفة', en: 'Light Rain' },
        63: { ar: 'أمطار متوسطة', en: 'Moderate Rain' },
        65: { ar: 'أمطار غزيرة', en: 'Heavy Rain' },
        80: { ar: 'زخات مطر خفيفة', en: 'Light Showers' },
        81: { ar: 'زخات مطر', en: 'Rain Showers' },
        82: { ar: 'زخات مطر غزيرة', en: 'Heavy Showers' },
        95: { ar: 'عاصفة رعدية', en: 'Thunderstorm' },
        96: { ar: 'عاصفة رعدية مع برد', en: 'Thunderstorm (Hail)' },
        99: { ar: 'عاصفة رعدية شديدة', en: 'Severe Thunderstorm' }
    };

    var currentLang = 'ar';
    try {
        var saved = global.localStorage.getItem('TV_LANG');
        if (saved === 'en' || saved === 'ar') currentLang = saved;
    } catch (e) {}

    TVApp.i18n = {
        getLang: function () { return currentLang; },
        setLang: function (lang) {
            currentLang = lang === 'en' ? 'en' : 'ar';
            try { global.localStorage.setItem('TV_LANG', currentLang); } catch (e) {}
            global.document.documentElement.lang = currentLang;
            global.document.documentElement.dir = currentLang === 'en' ? 'ltr' : 'rtl';
            global.document.title = this.dict().pageTitle;
        },
        toggleLang: function () {
            this.setLang(currentLang === 'ar' ? 'en' : 'ar');
            return currentLang;
        },
        dict: function () {
            return STRINGS[currentLang] || STRINGS.ar;
        },
        weatherDesc: function (code) {
            var n = Number(code);
            var item = WEATHER_LABELS[n];
            if (!item) return '—';
            return item[currentLang] || item.ar;
        },
        translateRequestType: function (arLabel) {
            if (currentLang === 'ar') return arLabel;
            var list = TVApp.config.GUEST_REQUEST_TYPES;
            for (var i = 0; i < list.length; i++) {
                if (list[i].ar === arLabel) return list[i].en;
            }
            return arLabel;
        }
    };
})(window);
