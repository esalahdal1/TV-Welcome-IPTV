(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};

    function normalizeDigits(input) {
        return String(input || '')
            .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
            .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    var params = new URLSearchParams(global.location.search);

    var sbUrlParam = params.get('sbUrl');
    var sbKeyParam = params.get('sbKey');
    if (sbUrlParam) {
        try { global.localStorage.setItem('SB_URL', sbUrlParam); } catch (e) {}
    }
    if (sbKeyParam) {
        try { global.localStorage.setItem('SB_KEY', sbKeyParam); } catch (e) {}
    }

    var SUPABASE_URL = sbUrlParam ||
        (function () { try { return global.localStorage.getItem('SB_URL'); } catch (e) { return null; } })() ||
        'https://ayfvvzawdbdcsiugazvn.supabase.co';

    var SUPABASE_KEY = sbKeyParam ||
        (function () { try { return global.localStorage.getItem('SB_KEY'); } catch (e) { return null; } })() ||
        'sb_publishable_V5a3JRO2UI371xQ-9MwT8w_J_8XT8Cm';

    var adminFlag = normalizeDigits((params.get('admin') || '').trim()).toLowerCase();
    var receptionFlag = normalizeDigits((params.get('reception') || '').trim()).toLowerCase();
    var guestFlag = normalizeDigits((params.get('guest') || '').trim()).toLowerCase();
    var modeParam = (params.get('mode') || '').trim().toLowerCase();
    var lobbyFlag = normalizeDigits((params.get('lobby') || '').trim()).toLowerCase();
    var roomParam = normalizeDigits((params.get('room') || '').trim());
    var pinParam = normalizeDigits((params.get('pin') || '').trim());

    TVApp.config = {
        SUPABASE_URL: SUPABASE_URL,
        SUPABASE_KEY: SUPABASE_KEY,
        IS_ADMIN: adminFlag === '1' || adminFlag === 'true',
        IS_RECEPTION: receptionFlag === '1' || receptionFlag === 'true',
        IS_GUEST_MOBILE: guestFlag === '1' || guestFlag === 'true',
        IS_LOBBY: modeParam === 'lobby' || lobbyFlag === '1' || lobbyFlag === 'true',
        ROOM: roomParam || null,
        PIN_PARAM: pinParam || null,
        ADMIN_PIN: '1234',
        HOTEL_DEFAULTS: {
            wifiName: 'Masaken_Guest',
            wifiPass: 'Masaken@2026',
            receptionExt: '0 / 100',
            breakfastHours: '07:00 - 10:30',
            checkoutTime: '14:00',
            websiteUrl: 'https://www.masaken-rc.com.sa',
            lat: 21.5433,
            lon: 39.1728,
            city: 'Jeddah',
            country: 'Saudi Arabia'
        },
        ENTERTAINMENT_APPS: [
            { id: 'netflix', nameAr: 'نتفلكس', nameEn: 'Netflix', logo: 'N', cls: 'netflix' },
            { id: 'shahid', nameAr: 'شاهد', nameEn: 'Shahid', logo: 'S', cls: 'shahid' },
            { id: 'appletv', nameAr: 'ابل تي في', nameEn: 'Apple TV', logo: '', cls: 'appletv' },
            { id: 'youtube', nameAr: 'يوتيوب', nameEn: 'YouTube', logo: '▶', cls: 'youtube' },
            { id: 'prime', nameAr: 'برايم فيديو', nameEn: 'Prime Video', logo: 'P', cls: 'prime' }
        ],
        CAST_RECEIVER_PACKAGES: [
            'com.ionitech.airscreen',
            'com.github.imirror',
            'com.screendock.airplay',
            'com.prat3ik.imirror'
        ],
        GUEST_REQUEST_TYPES: [
            { key: 'cleaning', icon: 'fa-broom', ar: 'خدمة تنظيف الغرف', en: 'Room Cleaning' },
            { key: 'towels', icon: 'fa-bath', ar: 'مناشف ومستلزمات إضافية', en: 'Extra Towels & Amenities' },
            { key: 'laundry', icon: 'fa-shirt', ar: 'خدمة الغسيل والكي', en: 'Laundry & Ironing' },
            { key: 'maintenance', icon: 'fa-wrench', ar: 'طلب صيانة في الغرفة', en: 'Room Maintenance' },
            { key: 'wake_up', icon: 'fa-bell', ar: 'طلب اتصال إيقاظ', en: 'Wake-up Call' },
            { key: 'early_checkout', icon: 'fa-door-open', ar: 'خروج مبكر', en: 'Early Check-out' }
        ]
    };

    TVApp.utils = {
        normalizeDigits: normalizeDigits,
        escapeHtml: escapeHtml,
        getOrCreateFallbackPin: function (room) {
            var key = 'ROOM_CAST_PIN_' + (room || 'GUEST');
            try {
                var existing = global.localStorage.getItem(key);
                if (existing && /^\d{4}$/.test(existing)) return existing;
                var generated = String(Math.floor(1000 + Math.random() * 9000));
                global.localStorage.setItem(key, generated);
                return generated;
            } catch (e) {
                return '4821';
            }
        },
        buildGuestMobileUrl: function (room, pin) {
            var base = global.location.origin + global.location.pathname;
            var q = new URLSearchParams();
            q.set('guest', '1');
            q.set('room', room || '101');
            if (pin) q.set('pin', pin);
            return base + '?' + q.toString();
        },
        renderQrInto: function (containerEl, targetUrl) {
            if (!containerEl) return false;
            if (typeof global.qrcode !== 'function') {
                containerEl.innerHTML = '<div class="qr-fallback">QR</div>';
                return false;
            }
            try {
                var qr = global.qrcode(0, 'M');
                qr.addData(targetUrl);
                qr.make();
                containerEl.innerHTML = qr.createSvgTag(4, 4);
                return true;
            } catch (e) {
                containerEl.innerHTML = '<div class="qr-fallback">QR</div>';
                return false;
            }
        }
    };
})(window);
