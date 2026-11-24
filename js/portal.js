(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var i18n = TVApp.i18n;
    var db = TVApp.db;
    var utils = TVApp.utils;
    var escapeHtml = utils.escapeHtml;

    var DOCK_IDS = ['tv', 'apps', 'services', 'cast', 'guide', 'lang'];
    var CAST_TABS = ['webrtc', 'airplay', 'chromecast', 'hdmi'];

    var state = {
        activeOverlay: null, // null | 'apps' | 'services' | 'cast' | 'guide'
        webrtcStreaming: false,
        dockIndex: 0,
        appsIndex: 0,
        serviceIndex: 0,
        castTabIndex: 0,
        guestNameValue: null,
        hasLoadedGuest: false,
        roomPin: utils.getOrCreateFallbackPin(cfg.ROOM),
        hotel: Object.assign({}, cfg.HOTEL_DEFAULTS),
        manualLangOverride: false,
        toastShowing: false,
        toastQueue: [],
        toastHideTimer: null
    };

    function $(id) {
        return global.document.getElementById(id);
    }

    function setDpadDownBlocked(blocked) {
        try {
            if (global.TVIP && typeof global.TVIP.setDpadDownBlocked === 'function') {
                global.TVIP.setDpadDownBlocked(!!blocked);
            }
        } catch (e) {}
    }

    function fitGuestName() {
        var el = $('guestName');
        if (!el || el.classList.contains('is-loading')) return;
        var s = parseFloat(global.getComputedStyle(global.document.documentElement).getPropertyValue('--stage-scale')) || 1;
        var maxHeight = 200 * s;
        var maxFont = 96;
        var minFont = 50;
        el.style.fontSize = maxFont + 'px';
        for (var size = maxFont; size >= minFont; size -= 2) {
            el.style.fontSize = size + 'px';
            if (el.getBoundingClientRect().height <= maxHeight) break;
        }
    }

    function applyStageScale() {
        var rootStyle = global.getComputedStyle(global.document.documentElement);
        var w = parseFloat(rootStyle.getPropertyValue('--stage-w')) || 1920;
        var h = parseFloat(rootStyle.getPropertyValue('--stage-h')) || 1080;
        var scale = Math.min(global.innerWidth / w, global.innerHeight / h);
        global.document.documentElement.style.setProperty('--stage-scale', String(scale));
        fitGuestName();
    }

    /* --- Toast Notifications --- */
    function showToast(message) {
        var host = $('toastHost');
        var text = $('toastText');
        if (!host || !text) return;
        text.textContent = message;
        host.style.display = 'block';
        host.style.opacity = '0';
        if (typeof host.animate === 'function') {
            host.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                { duration: 180, easing: 'ease-out', fill: 'forwards' }
            );
        } else {
            host.style.opacity = '1';
        }
        if (state.toastHideTimer) global.clearTimeout(state.toastHideTimer);
        state.toastHideTimer = global.setTimeout(function () {
            if (typeof host.animate === 'function') {
                host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
            }
            global.setTimeout(function () {
                host.style.display = 'none';
                state.toastShowing = false;
                flushToastQueue();
            }, 240);
        }, 5000);
    }

    function flushToastQueue() {
        if (state.toastShowing) return;
        var next = state.toastQueue.shift();
        if (!next) return;
        state.toastShowing = true;
        showToast(next);
    }

    function enqueueToast(message) {
        if (!message) return;
        state.toastQueue.push(message);
        flushToastQueue();
    }

    async function pollNotificationsOnce() {
        if (cfg.IS_ADMIN || cfg.IS_RECEPTION || cfg.IS_GUEST_MOBILE || !db.isReady()) return;
        var lastKey = 'NOTIF_LAST_SEEN_' + (cfg.ROOM || 'ALL');
        var lastSeen = '';
        try { lastSeen = (global.localStorage.getItem(lastKey) || '').trim(); } catch (e) {}

        if (!lastSeen) {
            try { global.localStorage.setItem(lastKey, new Date().toISOString()); } catch (e2) {}
            return;
        }

        var rows = await db.fetchNewNotifications(cfg.ROOM, lastSeen);
        if (!rows || rows.length === 0) return;

        var maxTs = lastSeen;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var msg = String((r && r.message) || '').trim();
            var created = String((r && r.created_at) || '').trim();
            if (created && created > maxTs) maxTs = created;
            if (msg) enqueueToast(msg);
        }
        if (maxTs !== lastSeen) {
            try { global.localStorage.setItem(lastKey, maxTs); } catch (e3) {}
        }
    }

    /* --- Guest & Settings Rendering --- */
    function renderGuestName() {
        var el = $('guestName');
        var roomPill = $('roomPill');
        var roomText = $('roomNumberText');
        var pinPill = $('roomPinPill');
        var pinBadgeVal = $('roomPinBadgeValue');
        if (roomPill && roomText) {
            if (cfg.ROOM) {
                roomPill.style.display = 'inline-flex';
                roomText.innerText = cfg.ROOM;
            } else {
                roomPill.style.display = 'none';
            }
        }
        if (pinPill && pinBadgeVal) {
            if (cfg.ROOM) {
                pinPill.style.display = 'inline-flex';
                pinBadgeVal.innerText = state.roomPin;
            } else {
                pinPill.style.display = 'none';
            }
        }
        if (!el) return;
        if (!state.hasLoadedGuest) return;
        el.classList.remove('is-loading');
        el.innerText = state.guestNameValue || i18n.dict().defaultGuest;
        fitGuestName();
    }

    async function fetchHotelSettings() {
        try {
            var cached = JSON.parse(global.localStorage.getItem('HOTEL_SETTINGS_CACHE') || 'null');
            if (cached) Object.assign(state.hotel, cached);
        } catch (e) {}

        var remote = await db.fetchHotelSettings();
        if (!remote) return;
        state.hotel.wifiName = remote.wifi_name || state.hotel.wifiName;
        state.hotel.wifiPass = remote.wifi_pass || state.hotel.wifiPass;
        state.hotel.receptionExt = remote.reception_ext || state.hotel.receptionExt;
        state.hotel.breakfastHours = remote.breakfast_hours || state.hotel.breakfastHours;
        state.hotel.checkoutTime = remote.checkout_time || state.hotel.checkoutTime;
        try { global.localStorage.setItem('HOTEL_SETTINGS_CACHE', JSON.stringify(state.hotel)); } catch (e2) {}
        if (state.activeOverlay === 'guide') renderGuideModal();
    }

    async function fetchGuest() {
        if (cfg.IS_ADMIN || cfg.IS_RECEPTION || cfg.IS_GUEST_MOBILE || cfg.IS_LOBBY) return;
        if (!cfg.ROOM) {
            state.guestNameValue = null;
            state.hasLoadedGuest = true;
            renderGuestName();
            return;
        }

        var prevPin = state.roomPin;
        var cacheKey = 'GUEST_NAME_CACHE_' + cfg.ROOM;
        var profile = await db.fetchGuestProfile(cfg.ROOM);

        if (profile && profile._offline) {
            try {
                var cachedName = global.localStorage.getItem(cacheKey);
                if (cachedName) state.guestNameValue = cachedName;
            } catch (e) {}
            state.hasLoadedGuest = true;
            renderGuestName();
            return;
        }

        state.guestNameValue = (profile && profile.full_name) ? String(profile.full_name).trim() : null;
        try {
            if (state.guestNameValue) global.localStorage.setItem(cacheKey, state.guestNameValue);
            else global.localStorage.removeItem(cacheKey);
        } catch (e2) {}

        if (profile && profile.cast_pin && /^\d{4}$/.test(String(profile.cast_pin).trim())) {
            state.roomPin = String(profile.cast_pin).trim();
            try { global.localStorage.setItem('ROOM_CAST_PIN_' + cfg.ROOM, state.roomPin); } catch (e3) {}
        } else if (profile === null) {
            db.syncTvPin(cfg.ROOM, state.roomPin);
        }
        if (!state.manualLangOverride && profile && (profile.preferred_lang === 'ar' || profile.preferred_lang === 'en')) {
            if (profile.preferred_lang !== i18n.getLang()) {
                i18n.setLang(profile.preferred_lang);
                applyLanguageToDom();
            }
        }
        state.hasLoadedGuest = true;
        renderGuestName();

        if (prevPin !== state.roomPin) {
            syncWebrtcReceiver();
            if (state.activeOverlay === 'cast') renderCastModal();
            if (state.activeOverlay === 'guide') renderGuideModal();
        }
    }

    function syncWebrtcReceiver() {
        if (!TVApp.webrtcCast || cfg.IS_ADMIN || cfg.IS_RECEPTION || cfg.IS_GUEST_MOBILE) return;
        var roomTag = cfg.ROOM || '101';
        TVApp.webrtcCast.startReceiver(roomTag, state.roomPin, {
            onStream: function (stream) {
                var stage = $('webrtcCastStage');
                var video = $('tvCastVideo');
                var label = $('webrtcCastBannerText');
                var stopBtn = $('webrtcStopTvBtn');
                if (label) label.innerText = i18n.dict().castWebrtcActiveBanner;
                if (stopBtn) stopBtn.innerText = i18n.dict().castWebrtcStopBtn;
                closeAllOverlays();
                state.webrtcStreaming = true;
                setDpadDownBlocked(true);
                if (video) {
                    video.srcObject = stream;
                    video.play().catch(function () {});
                }
                if (stage) stage.style.display = 'block';
            },
            onStop: function () {
                var stage = $('webrtcCastStage');
                var video = $('tvCastVideo');
                state.webrtcStreaming = false;
                if (video) video.srcObject = null;
                if (stage) stage.style.display = 'none';
                if (!state.activeOverlay) setDpadDownBlocked(false);
            }
        });
    }

    /* --- Dock & Static Translations --- */
    function renderDock() {
        var dock = $('actionDock');
        if (!dock) return;
        var d = i18n.dict().dock;
        var items = [
            { id: 'tv', icon: 'fa-tv', title: d.tvTitle, sub: d.tvSub },
            { id: 'apps', icon: 'fa-film', title: d.appsTitle, sub: d.appsSub },
            { id: 'services', icon: 'fa-concierge-bell', title: d.servicesTitle, sub: d.servicesSub },
            { id: 'cast', icon: 'fa-laptop', title: d.castTitle, sub: d.castSub },
            { id: 'guide', icon: 'fa-hotel', title: d.guideTitle, sub: d.guideSub },
            { id: 'lang', icon: 'fa-language', title: d.langTitle, sub: d.langSub }
        ];

        dock.innerHTML = items.map(function (it, idx) {
            var focused = (state.activeOverlay === null && idx === state.dockIndex) ? ' is-focused' : '';
            return '<button type="button" class="dock-btn' + focused + '" data-dock-idx="' + idx + '" data-dock-id="' + it.id + '">' +
                '<i class="fas ' + it.icon + '"></i>' +
                '<span class="dock-btn-title">' + escapeHtml(it.title) + '</span>' +
                '<span class="dock-btn-sub">' + escapeHtml(it.sub) + '</span>' +
                '</button>';
        }).join('');

        dock.querySelectorAll('button[data-dock-idx]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = Number(btn.getAttribute('data-dock-idx') || '0') || 0;
                state.dockIndex = idx;
                updateDockFocus();
                activateDockItem(DOCK_IDS[idx]);
            });
        });
    }

    function updateDockFocus() {
        var dock = $('actionDock');
        if (!dock) return;
        dock.querySelectorAll('.dock-btn').forEach(function (el, idx) {
            el.classList.toggle('is-focused', state.activeOverlay === null && idx === state.dockIndex);
        });
    }

    function applyLanguageToDom() {
        var d = i18n.dict();
        var setText = function (id, txt) {
            var el = $(id);
            if (el) el.innerText = txt;
        };

        setText('hotelNameText', d.hotelBrand);
        setText('weatherCityText', d.cityLabel);
        setText('roomLabelText', d.roomLabel);
        setText('roomPinLabelText', d.roomPinPillLabel);
        setText('stayLabelText', d.stayLabel);
        setText('stayValueText', d.stayValue);
        setText('welcomeSubText', d.welcomeSub);
        setText('companyNameText', d.companyName);
        setText('companySubText', d.companySub);

        var hintEl = $('remoteHint');
        if (hintEl) hintEl.innerHTML = d.remoteHintHtml;

        document.querySelectorAll('[data-close-label]').forEach(function (btn) {
            btn.innerText = d.closeBtn;
        });

        renderGuestName();
        renderDock();
        TVApp.widgets.refreshLanguage();

        if (state.activeOverlay === 'apps') renderAppsList();
        if (state.activeOverlay === 'services') renderServicesModal();
        if (state.activeOverlay === 'cast') renderCastModal();
        if (state.activeOverlay === 'guide') renderGuideModal();
    }

    /* --- Overlay Open / Close --- */
    function closeAllOverlays() {
        state.activeOverlay = null;
        setDpadDownBlocked(false);
        ['appsMenu', 'servicesModal', 'castModal', 'guideModal'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = 'none';
        });
        updateDockFocus();
    }

    function openOverlay(name) {
        closeAllOverlays();
        state.activeOverlay = name;
        setDpadDownBlocked(true);
        updateDockFocus();
    }

    /* --- Apps Drawer --- */
    function renderAppsList() {
        var d = i18n.dict();
        var lang = i18n.getLang();
        var titleEl = $('appsTitle');
        var hintEl = $('appsHint');
        var listEl = $('appsList');
        if (titleEl) titleEl.innerText = d.appsModalTitle;
        if (hintEl) hintEl.innerText = d.appsHint;
        if (!listEl) return;

        listEl.innerHTML = cfg.ENTERTAINMENT_APPS.map(function (a, idx) {
            var focused = idx === state.appsIndex ? ' is-focused' : '';
            var label = lang === 'en' ? a.nameEn : a.nameAr;
            return '<button type="button" class="app-item' + focused + '" data-app-idx="' + idx + '">' +
                '<span class="app-logo ' + a.cls + '">' + escapeHtml(a.logo) + '</span>' +
                '<span>' + escapeHtml(label) + '</span>' +
                '</button>';
        }).join('');

        listEl.querySelectorAll('button[data-app-idx]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.appsIndex = Number(btn.getAttribute('data-app-idx') || '0') || 0;
                launchFocusedApp();
            });
        });
    }

    function openAppsMenu() {
        var menu = $('appsMenu');
        if (!menu) return;
        openOverlay('apps');
        state.appsIndex = 0;
        renderAppsList();
        menu.style.display = 'block';
    }

    function launchFocusedApp() {
        var app = cfg.ENTERTAINMENT_APPS[state.appsIndex];
        if (!app) return;
        closeAllOverlays();
        global.location.href = 'tvip://launch?id=' + encodeURIComponent(app.id);
    }

    /* --- Room Services Modal --- */
    async function loadRecentRoomRequests() {
        var listEl = $('servicesRecentList');
        var titleEl = $('servicesRecentTitle');
        var d = i18n.dict();
        if (titleEl) titleEl.innerText = d.recentRequestsTitle;
        if (!listEl) return;

        if (!cfg.ROOM) {
            listEl.innerHTML = '<div class="recent-empty">' + escapeHtml(d.recentRequestsEmpty) + '</div>';
            return;
        }
        var rows = await db.listRoomRequests(cfg.ROOM);
        if (!rows || rows.length === 0) {
            listEl.innerHTML = '<div class="recent-empty">' + escapeHtml(d.recentRequestsEmpty) + '</div>';
            return;
        }
        listEl.innerHTML = rows.slice(0, 4).map(function (r) {
            var done = r.status === 'done';
            var badgeCls = done ? 'req-badge is-done' : 'req-badge is-pending';
            var badgeTxt = done ? d.statusDone : d.statusPending;
            var label = i18n.translateRequestType(r.request_type || '');
            return '<div class="recent-row">' +
                '<span class="recent-label">' + escapeHtml(label) + '</span>' +
                '<span class="' + badgeCls + '">' + escapeHtml(badgeTxt) + '</span>' +
                '</div>';
        }).join('');
    }

    function renderServicesModal() {
        var d = i18n.dict();
        var lang = i18n.getLang();
        var titleEl = $('servicesModalTitle');
        var gridEl = $('servicesGrid');
        var statusEl = $('servicesStatus');
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-concierge-bell"></i><span>' + escapeHtml(d.servicesModalTitle) + '</span>';
        if (statusEl) {
            statusEl.className = 'service-status';
            statusEl.innerText = cfg.ROOM ? '' : d.servicesNoteNoRoom;
        }
        if (!gridEl) return;

        gridEl.innerHTML = cfg.GUEST_REQUEST_TYPES.map(function (req, idx) {
            var focused = idx === state.serviceIndex ? ' is-focused' : '';
            var label = lang === 'en' ? req.en : req.ar;
            return '<button type="button" class="service-option' + focused + '" data-req-idx="' + idx + '">' +
                '<i class="fas ' + req.icon + '"></i>' +
                '<span>' + escapeHtml(label) + '</span>' +
                '</button>';
        }).join('');

        gridEl.querySelectorAll('button[data-req-idx]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.serviceIndex = Number(btn.getAttribute('data-req-idx') || '0') || 0;
                updateServiceFocus();
                submitGuestServiceRequest();
            });
        });

        loadRecentRoomRequests();
    }

    function updateServiceFocus() {
        var gridEl = $('servicesGrid');
        if (!gridEl) return;
        gridEl.querySelectorAll('.service-option').forEach(function (el, idx) {
            el.classList.toggle('is-focused', idx === state.serviceIndex);
        });
    }

    function openServicesModal() {
        var modal = $('servicesModal');
        if (!modal) return;
        openOverlay('services');
        state.serviceIndex = 0;
        renderServicesModal();
        modal.style.display = 'flex';
    }

    async function submitGuestServiceRequest() {
        var d = i18n.dict();
        var statusEl = $('servicesStatus');
        if (!cfg.ROOM) {
            if (statusEl) {
                statusEl.className = 'service-status is-error';
                statusEl.innerText = d.servicesNoteNoRoom;
            }
            return;
        }
        var req = cfg.GUEST_REQUEST_TYPES[state.serviceIndex];
        if (!req) return;
        if (statusEl) {
            statusEl.className = 'service-status';
            statusEl.innerText = d.servicesSending;
        }

        var res = await db.insertGuestRequest(cfg.ROOM, req.ar);
        if (res && res.error) {
            if (statusEl) {
                statusEl.className = 'service-status is-error';
                statusEl.innerText = d.servicesErrorPrefix + (res.error.message || '');
            }
            return;
        }
        if (statusEl) {
            statusEl.className = 'service-status';
            statusEl.innerText = d.servicesSent;
        }
        enqueueToast(d.servicesSent);
        loadRecentRoomRequests();
        global.setTimeout(function () {
            if (state.activeOverlay === 'services') closeAllOverlays();
        }, 1200);
    }

    /* --- Shared QR Renderer for Modals --- */
    function populateMobileQr(qrEl, labelEl, linkEl, labelText) {
        var roomTag = cfg.ROOM || '101';
        var mobileUrl = utils.buildGuestMobileUrl(roomTag, state.roomPin);
        if (qrEl) utils.renderQrInto(qrEl, mobileUrl);
        if (labelEl) labelEl.innerText = labelText;
        if (linkEl) {
            if (!global.TVIP) {
                linkEl.style.display = 'inline-flex';
                linkEl.href = mobileUrl;
                linkEl.innerText = i18n.dict().castPreviewMobileBtn;
            } else {
                linkEl.style.display = 'none';
            }
        }
    }

    /* --- Screen Cast & HDMI Modal --- */
    function launchCastReceiver() {
        if (!global.TVIP) {
            enqueueToast(i18n.dict().castReceiverPreviewToast);
            return;
        }
        var pkgs = (cfg.CAST_RECEIVER_PACKAGES || []).join(',');
        closeAllOverlays();
        global.location.href = 'tvip://launch?pkg=' + encodeURIComponent(pkgs);
    }

    function renderCastModal() {
        var d = i18n.dict();
        var titleEl = $('castModalTitle');
        var tabsEl = $('castTabs');
        var stepsEl = $('castSteps');
        var webrtcStatusBox = $('castWebrtcStatusBox');
        var webrtcStatusTxt = $('castWebrtcStatusText');
        var launchBtn = $('castLaunchReceiverBtn');
        var pinLabelEl = $('castPinLabel');
        var pinValEl = $('castPinValue');
        var deviceEl = $('castDeviceName');
        var pinNoteEl = $('castPinNote');

        if (titleEl) titleEl.innerHTML = '<i class="fas fa-laptop"></i><span>' + escapeHtml(d.castModalTitle) + '</span>';

        if (tabsEl) {
            tabsEl.innerHTML = CAST_TABS.map(function (tabKey, idx) {
                var active = idx === state.castTabIndex ? ' active is-focused' : '';
                var icon = tabKey === 'webrtc' ? 'fa-wifi' : (tabKey === 'airplay' ? 'fa-mobile-alt' : (tabKey === 'chromecast' ? 'fa-tv' : 'fa-plug'));
                return '<button type="button" class="modal-tab' + active + '" data-cast-tab="' + idx + '">' +
                    '<i class="fas ' + icon + '"></i><span>' + escapeHtml(d.castTabs[tabKey]) + '</span></button>';
            }).join('');

            tabsEl.querySelectorAll('button[data-cast-tab]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    state.castTabIndex = Number(btn.getAttribute('data-cast-tab') || '0') || 0;
                    renderCastModal();
                });
            });
        }

        var activeKey = CAST_TABS[state.castTabIndex] || 'webrtc';
        var steps = d.castSteps[activeKey] || [];
        if (stepsEl) {
            stepsEl.innerHTML = steps.map(function (s, i) {
                return '<div class="cast-step">' +
                    '<span class="cast-step-num">' + (i + 1) + '</span>' +
                    '<span>' + escapeHtml(s) + '</span>' +
                    '</div>';
            }).join('');
        }

        if (webrtcStatusBox && webrtcStatusTxt) {
            if (activeKey === 'webrtc') {
                webrtcStatusBox.style.display = 'flex';
                webrtcStatusTxt.innerText = d.castWebrtcWaiting;
            } else {
                webrtcStatusBox.style.display = 'none';
            }
        }

        if (launchBtn) {
            if (activeKey === 'airplay' || activeKey === 'chromecast') {
                launchBtn.style.display = 'inline-flex';
                launchBtn.innerHTML = '<i class="fas fa-external-link-alt"></i><span>' + escapeHtml(d.castLaunchReceiverBtn) + '</span>';
            } else {
                launchBtn.style.display = 'none';
            }
        }

        var roomTag = cfg.ROOM || '101';
        if (pinLabelEl) pinLabelEl.innerText = d.castPinLabel;
        if (pinValEl) pinValEl.innerText = state.roomPin;
        if (deviceEl) deviceEl.innerText = d.castDeviceLabel + ' Masaken Room ' + roomTag;
        if (pinNoteEl) pinNoteEl.innerText = d.castPinNote;

        populateMobileQr($('castQrBox'), $('castQrTitle'), $('castPreviewLink'), d.castQrScanTitle);
    }

    function openCastModal() {
        var modal = $('castModal');
        if (!modal) return;
        openOverlay('cast');
        state.castTabIndex = 0;
        renderCastModal();
        modal.style.display = 'flex';
    }

    /* --- Hotel Guide & Wi-Fi Modal --- */
    function renderGuideModal() {
        var d = i18n.dict();
        var h = state.hotel;
        var titleEl = $('guideModalTitle');
        var gridEl = $('guideGrid');
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-hotel"></i><span>' + escapeHtml(d.guideModalTitle) + '</span>';
        if (gridEl) {
            var cards = [
                { icon: 'fa-wifi', label: d.guideLabels.wifiName, val: h.wifiName },
                { icon: 'fa-key', label: d.guideLabels.wifiPass, val: h.wifiPass },
                { icon: 'fa-phone', label: d.guideLabels.reception, val: h.receptionExt },
                { icon: 'fa-utensils', label: d.guideLabels.breakfast, val: h.breakfastHours },
                { icon: 'fa-clock', label: d.guideLabels.checkout, val: h.checkoutTime },
                { icon: 'fa-map-marker-alt', label: d.guideLabels.address, val: d.cityLabel }
            ];

            gridEl.innerHTML = cards.map(function (c) {
                return '<div class="guide-card">' +
                    '<div class="guide-card-label"><i class="fas ' + c.icon + '"></i><span>' + escapeHtml(c.label) + '</span></div>' +
                    '<div class="guide-card-val">' + escapeHtml(c.val) + '</div>' +
                    '</div>';
            }).join('');
        }

        populateMobileQr($('guideQrBox'), $('guideQrTitle'), $('guidePreviewLink'), d.guideQrLabel);
    }

    function openGuideModal() {
        var modal = $('guideModal');
        if (!modal) return;
        openOverlay('guide');
        renderGuideModal();
        modal.style.display = 'flex';
    }

    /* --- Dock Activation --- */
    function activateDockItem(id) {
        if (id === 'tv') {
            if (global.TVIP && typeof global.TVIP.openLiveTv === 'function') {
                global.TVIP.openLiveTv();
            } else if (global.TVIP) {
                global.location.href = 'tvip://tv';
            } else {
                enqueueToast(i18n.dict().tvIptvPreviewToast);
            }
            return;
        }
        if (id === 'apps') { openAppsMenu(); return; }
        if (id === 'services') { openServicesModal(); return; }
        if (id === 'cast') { openCastModal(); return; }
        if (id === 'guide') { openGuideModal(); return; }
        if (id === 'lang') {
            state.manualLangOverride = true;
            i18n.toggleLang();
            applyLanguageToDom();
        }
    }

    /* --- DPAD Remote Keyboard Handling --- */
    function isOkKey(e) {
        var kc = e.keyCode || e.which || 0;
        return e.key === 'Enter' || e.key === 'OK' || e.key === 'Select' || e.code === 'Enter' || kc === 23 || kc === 66;
    }
    function isBackKey(e) {
        var kc = e.keyCode || e.which || 0;
        return e.key === 'Backspace' || e.key === 'Escape' || kc === 4 || kc === 111;
    }
    function isUpKey(e) {
        var kc = e.keyCode || e.which || 0;
        return e.key === 'ArrowUp' || kc === 19 || kc === 38;
    }
    function isDownKey(e) {
        var kc = e.keyCode || e.which || 0;
        return e.key === 'ArrowDown' || kc === 20 || kc === 40;
    }
    function isLeftKey(e) {
        var kc = e.keyCode || e.which || 0;
        return e.key === 'ArrowLeft' || kc === 21 || kc === 37;
    }
    function isRightKey(e) {
        var kc = e.keyCode || e.which || 0;
        return e.key === 'ArrowRight' || kc === 22 || kc === 39;
    }

    function handleOverlayKey(e) {
        if (isBackKey(e)) {
            e.preventDefault();
            closeAllOverlays();
            return true;
        }

        if (state.activeOverlay === 'apps') {
            if (isLeftKey(e)) { e.preventDefault(); closeAllOverlays(); return true; }
            if (isUpKey(e)) {
                e.preventDefault();
                state.appsIndex = Math.max(0, state.appsIndex - 1);
                renderAppsList();
                return true;
            }
            if (isDownKey(e)) {
                e.preventDefault();
                state.appsIndex = Math.min(cfg.ENTERTAINMENT_APPS.length - 1, state.appsIndex + 1);
                renderAppsList();
                return true;
            }
            if (isOkKey(e)) { e.preventDefault(); launchFocusedApp(); return true; }
            return true;
        }

        if (state.activeOverlay === 'services') {
            var total = cfg.GUEST_REQUEST_TYPES.length;
            var rtl = i18n.getLang() === 'ar';
            if (isUpKey(e)) {
                e.preventDefault();
                state.serviceIndex = Math.max(0, state.serviceIndex - 2);
                updateServiceFocus();
                return true;
            }
            if (isDownKey(e)) {
                e.preventDefault();
                state.serviceIndex = Math.min(total - 1, state.serviceIndex + 2);
                updateServiceFocus();
                return true;
            }
            if (isLeftKey(e) || isRightKey(e)) {
                e.preventDefault();
                var delta = (isLeftKey(e) ? 1 : -1) * (rtl ? 1 : -1);
                state.serviceIndex = (state.serviceIndex + delta + total) % total;
                updateServiceFocus();
                return true;
            }
            if (isOkKey(e)) { e.preventDefault(); submitGuestServiceRequest(); return true; }
            return true;
        }

        if (state.activeOverlay === 'cast') {
            var rtlCast = i18n.getLang() === 'ar';
            if (isLeftKey(e) || isRightKey(e)) {
                e.preventDefault();
                var step = (isLeftKey(e) ? 1 : -1) * (rtlCast ? 1 : -1);
                state.castTabIndex = (state.castTabIndex + step + CAST_TABS.length) % CAST_TABS.length;
                renderCastModal();
                return true;
            }
            if (isOkKey(e)) {
                var activeTab = CAST_TABS[state.castTabIndex];
                if (activeTab === 'airplay' || activeTab === 'chromecast') {
                    e.preventDefault();
                    launchCastReceiver();
                    return true;
                }
            }
            return true;
        }

        if (state.activeOverlay === 'guide') {
            if (isOkKey(e)) { e.preventDefault(); closeAllOverlays(); return true; }
            return true;
        }

        return false;
    }

    function bindEvents() {
        global.addEventListener('resize', applyStageScale);

        var launchBtn = $('castLaunchReceiverBtn');
        if (launchBtn) launchBtn.addEventListener('click', launchCastReceiver);

        var stopTvBtn = $('webrtcStopTvBtn');
        if (stopTvBtn) stopTvBtn.addEventListener('click', function () {
            if (TVApp.webrtcCast) TVApp.webrtcCast.stopBroadcastFromTv();
        });

        document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
            btn.addEventListener('click', closeAllOverlays);
        });

        ['servicesModal', 'castModal', 'guideModal'].forEach(function (id) {
            var el = $(id);
            if (el) {
                el.addEventListener('click', function (e) {
                    if (e.target === el) closeAllOverlays();
                });
            }
        });

        global.document.addEventListener('keydown', function (e) {
            if (cfg.IS_ADMIN || cfg.IS_RECEPTION || cfg.IS_GUEST_MOBILE) return;
            if (state.webrtcStreaming) {
                if (isBackKey(e) || isOkKey(e)) {
                    e.preventDefault();
                    if (TVApp.webrtcCast) TVApp.webrtcCast.stopBroadcastFromTv();
                }
                return;
            }
            if (state.activeOverlay && handleOverlayKey(e)) return;

            var rtl = i18n.getLang() === 'ar';
            if (isLeftKey(e) || isRightKey(e)) {
                e.preventDefault();
                var delta = (isLeftKey(e) ? 1 : -1) * (rtl ? 1 : -1);
                state.dockIndex = (state.dockIndex + delta + DOCK_IDS.length) % DOCK_IDS.length;
                updateDockFocus();
                return;
            }

            if (isUpKey(e)) {
                e.preventDefault();
                openServicesModal();
                return;
            }

            if (isDownKey(e)) {
                if (!global.TVIP) {
                    e.preventDefault();
                    enqueueToast(i18n.dict().tvIptvPreviewToast);
                }
                return;
            }

            if (isOkKey(e)) {
                e.preventDefault();
                activateDockItem(DOCK_IDS[state.dockIndex]);
            }
        });
    }

    TVApp.portal = {
        init: function () {
            i18n.setLang(i18n.getLang());
            applyStageScale();
            TVApp.widgets.init();
            applyLanguageToDom();
            setDpadDownBlocked(false);
            bindEvents();

            syncWebrtcReceiver();
            fetchHotelSettings();
            fetchGuest();
            global.setInterval(fetchGuest, 30000);
            global.setInterval(fetchHotelSettings, 120000);
            global.setTimeout(pollNotificationsOnce, 3000);
            global.setInterval(pollNotificationsOnce, 20000);
        },
        handleNativeBack: function () {
            if (state.webrtcStreaming) {
                if (TVApp.webrtcCast) TVApp.webrtcCast.stopBroadcastFromTv();
                return true;
            }
            if (state.activeOverlay) {
                closeAllOverlays();
                return true;
            }
            return false;
        },
        enqueueToast: enqueueToast
    };
})(window);
