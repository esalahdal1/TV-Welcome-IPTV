(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var i18n = TVApp.i18n;
    var db = TVApp.db;
    var utils = TVApp.utils;
    var escapeHtml = utils.escapeHtml;

    var state = {
        slideIndex: 0,
        hotel: Object.assign({}, cfg.HOTEL_DEFAULTS),
        latestAnnouncement: null,
        rotateTimer: null,
        toastShowing: false,
        toastQueue: [],
        toastHideTimer: null
    };

    function $(id) {
        return global.document.getElementById(id);
    }

    function applyStageScale() {
        var rootStyle = global.getComputedStyle(global.document.documentElement);
        var w = parseFloat(rootStyle.getPropertyValue('--stage-w')) || 1920;
        var h = parseFloat(rootStyle.getPropertyValue('--stage-h')) || 1080;
        var scale = Math.min(global.innerWidth / w, global.innerHeight / h);
        global.document.documentElement.style.setProperty('--stage-scale', String(scale));
    }

    function showToast(message) {
        var host = $('toastHost');
        var text = $('toastText');
        if (!host || !text) return;
        text.textContent = message;
        host.style.display = 'block';
        host.style.opacity = '1';
        if (state.toastHideTimer) global.clearTimeout(state.toastHideTimer);
        state.toastHideTimer = global.setTimeout(function () {
            host.style.display = 'none';
            state.toastShowing = false;
            flushToastQueue();
        }, 6000);
    }

    function flushToastQueue() {
        if (state.toastShowing) return;
        var next = state.toastQueue.shift();
        if (!next) return;
        state.toastShowing = true;
        showToast(next);
    }

    function enqueueToast(msg) {
        if (!msg) return;
        state.toastQueue.push(msg);
        flushToastQueue();
    }

    async function pollGlobalAnnouncements() {
        if (!db.isReady()) return;
        var lastKey = 'NOTIF_LAST_SEEN_LOBBY';
        var lastSeen = '';
        try { lastSeen = (global.localStorage.getItem(lastKey) || '').trim(); } catch (e) {}

        if (!lastSeen) {
            try { global.localStorage.setItem(lastKey, new Date().toISOString()); } catch (e2) {}
        } else {
            var rows = await db.fetchNewNotifications(null, lastSeen);
            if (rows && rows.length > 0) {
                var maxTs = lastSeen;
                for (var i = 0; i < rows.length; i++) {
                    var msg = String((rows[i] && rows[i].message) || '').trim();
                    var created = String((rows[i] && rows[i].created_at) || '').trim();
                    if (created && created > maxTs) maxTs = created;
                    if (msg) {
                        state.latestAnnouncement = msg;
                        enqueueToast(msg);
                    }
                }
                if (maxTs !== lastSeen) {
                    try { global.localStorage.setItem(lastKey, maxTs); } catch (e3) {}
                }
            }
        }

        if (!state.latestAnnouncement) {
            var latest = await db.fetchLatestGlobalNotification();
            if (latest && latest.message) {
                state.latestAnnouncement = String(latest.message).trim();
            }
        }
        renderSlide();
    }

    async function loadHotelSettings() {
        try {
            var cached = JSON.parse(global.localStorage.getItem('HOTEL_SETTINGS_CACHE') || 'null');
            if (cached) Object.assign(state.hotel, cached);
        } catch (e) {}

        var remote = await db.fetchHotelSettings();
        if (remote) {
            state.hotel.wifiName = remote.wifi_name || state.hotel.wifiName;
            state.hotel.wifiPass = remote.wifi_pass || state.hotel.wifiPass;
            state.hotel.receptionExt = remote.reception_ext || state.hotel.receptionExt;
            state.hotel.breakfastHours = remote.breakfast_hours || state.hotel.breakfastHours;
            state.hotel.checkoutTime = remote.checkout_time || state.hotel.checkoutTime;
            try { global.localStorage.setItem('HOTEL_SETTINGS_CACHE', JSON.stringify(state.hotel)); } catch (e2) {}
        }
        renderSlide();
    }

    function buildSlides() {
        var d = i18n.dict();
        var lb = d.lobby;
        var h = state.hotel;

        var slides = [
            {
                tag: lb.slide1Tag,
                title: lb.slide1Title,
                body: lb.slide1Body,
                highlights: lb.slide1Highlights,
                qrUrl: null
            },
            {
                tag: lb.slide2Tag,
                title: lb.slide2Title,
                body: lb.slide2Body,
                highlights: [
                    { icon: 'fa-wifi', label: d.guideLabels.wifiName, val: h.wifiName },
                    { icon: 'fa-key', label: d.guideLabels.wifiPass, val: h.wifiPass },
                    { icon: 'fa-phone', label: d.guideLabels.reception, val: h.receptionExt }
                ],
                qrUrl: h.websiteUrl,
                qrCaption: lb.websiteQrCaption
            },
            {
                tag: lb.slide3Tag,
                title: lb.slide3Title,
                body: lb.slide3Body,
                highlights: [
                    { icon: 'fa-utensils', label: d.guideLabels.breakfast, val: h.breakfastHours },
                    { icon: 'fa-clock', label: d.guideLabels.checkout, val: h.checkoutTime },
                    { icon: 'fa-plane-departure', label: d.guideLabels.airport, val: lb.airportDistance }
                ],
                qrUrl: null
            }
        ];

        if (state.latestAnnouncement) {
            slides.push({
                tag: lb.slide4Tag,
                title: lb.slide4Title,
                body: state.latestAnnouncement,
                highlights: [],
                qrUrl: null
            });
        }

        return slides;
    }

    function renderSlide() {
        var d = i18n.dict();
        var lb = d.lobby;
        var slides = buildSlides();
        if (state.slideIndex >= slides.length) state.slideIndex = 0;
        var s = slides[state.slideIndex];

        if ($('lobbyTag')) $('lobbyTag').innerText = s.tag;
        if ($('lobbyTitle')) $('lobbyTitle').innerText = s.title;
        if ($('lobbyBody')) $('lobbyBody').innerText = s.body;
        if ($('lobbyBadgeText')) $('lobbyBadgeText').innerText = lb.badge;
        if ($('companyNameText')) $('companyNameText').innerText = d.companyName;
        if ($('companySubText')) $('companySubText').innerText = d.companySub;
        if ($('weatherCityText')) $('weatherCityText').innerText = d.cityLabel;
        if ($('remoteHint')) $('remoteHint').innerHTML = lb.hintHtml;

        var grid = $('lobbyHighlights');
        if (grid) {
            if (s.highlights && s.highlights.length > 0) {
                grid.style.display = 'grid';
                grid.innerHTML = s.highlights.map(function (it) {
                    return '<div class="lobby-stat-card">' +
                        '<div class="lobby-stat-label"><i class="fas ' + it.icon + '"></i><span>' + escapeHtml(it.label) + '</span></div>' +
                        '<div class="lobby-stat-val">' + escapeHtml(it.val) + '</div>' +
                        '</div>';
                }).join('');
            } else {
                grid.style.display = 'none';
                grid.innerHTML = '';
            }
        }

        var qrSide = $('lobbyQrSide');
        var qrBox = $('lobbyQrBox');
        var qrCap = $('lobbyQrCaption');
        if (qrSide && qrBox && qrCap) {
            if (s.qrUrl) {
                qrSide.style.display = 'flex';
                utils.renderQrInto(qrBox, s.qrUrl);
                qrCap.innerText = s.qrCaption || '';
            } else {
                qrSide.style.display = 'none';
            }
        }

        var dots = $('lobbyDots');
        if (dots) {
            dots.innerHTML = slides.map(function (_, idx) {
                return '<span class="lobby-dot' + (idx === state.slideIndex ? ' active' : '') + '"></span>';
            }).join('');
        }
    }

    function nextSlide(step) {
        var slides = buildSlides();
        state.slideIndex = (state.slideIndex + step + slides.length) % slides.length;
        renderSlide();
    }

    function bindEvents() {
        global.addEventListener('resize', applyStageScale);
        global.document.addEventListener('keydown', function (e) {
            var kc = e.keyCode || e.which || 0;
            if (e.key === 'ArrowLeft' || kc === 21 || kc === 37) {
                e.preventDefault();
                nextSlide(i18n.getLang() === 'ar' ? 1 : -1);
                return;
            }
            if (e.key === 'ArrowRight' || kc === 22 || kc === 39) {
                e.preventDefault();
                nextSlide(i18n.getLang() === 'ar' ? -1 : 1);
                return;
            }
            if (e.key === 'Enter' || e.key === 'OK' || e.key === 'Select' || kc === 23 || kc === 66) {
                e.preventDefault();
                i18n.toggleLang();
                TVApp.widgets.refreshLanguage();
                renderSlide();
            }
        });
    }

    async function sendLobbyWebHeartbeat() {
        if (!cfg.IS_SIMULATOR && !cfg.IS_WEB_TV) return;
        if (!db || !db.sendTvHeartbeat) return;
        try {
            if (global.TVIP && typeof global.TVIP.hasNativeMonitor === 'function' && global.TVIP.hasNativeMonitor()) {
                return;
            }
        } catch (e) {}
        var devId = '';
        try {
            devId = global.localStorage.getItem('TV_WEB_DEVICE_ID') || '';
            if (!devId) {
                devId = 'lobby-' + Math.random().toString(36).slice(2, 10);
                global.localStorage.setItem('TV_WEB_DEVICE_ID', devId);
            }
        } catch (e2) { devId = 'lobby-web'; }
        var res = await db.sendTvHeartbeat({
            room: '',
            mode: 'lobby',
            screen_state: 'lobby',
            app_version: cfg.IS_SIMULATOR ? 'sim' : 'web',
            platform: cfg.IS_SIMULATOR ? 'simulator' : 'web_tv',
            device_id: devId
        });
        if (res && Array.isArray(res.commands)) {
            res.commands.forEach(function (item) {
                var cmd = item && item.command ? String(item.command) : '';
                if (cmd === 'reload') {
                    if (global.TVIP && typeof global.TVIP.reloadPortal === 'function') global.TVIP.reloadPortal();
                    else global.location.reload();
                } else if (cmd === 'open_tv' && global.TVIP && typeof global.TVIP.openLiveTv === 'function') {
                    global.TVIP.openLiveTv();
                } else if (cmd === 'update_apk' && global.TVIP && typeof global.TVIP.installAppUpdate === 'function') {
                    global.TVIP.installAppUpdate();
                }
            });
        }
    }

    TVApp.lobby = {
        init: function () {
            i18n.setLang(i18n.getLang());
            applyStageScale();
            TVApp.widgets.init();

            var hero = $('roomHeroSection');
            var dock = $('actionDock');
            var lobbySignage = $('lobbySignage');
            if (hero) hero.style.display = 'none';
            if (dock) dock.style.display = 'none';
            if (lobbySignage) lobbySignage.style.display = 'flex';

            try {
                if (global.TVIP && typeof global.TVIP.setDpadDownBlocked === 'function') {
                    global.TVIP.setDpadDownBlocked(false);
                }
            } catch (e) {}

            renderSlide();
            bindEvents();
            loadHotelSettings();
            pollGlobalAnnouncements();
            sendLobbyWebHeartbeat();

            state.rotateTimer = global.setInterval(function () {
                nextSlide(1);
            }, 9000);
            global.setInterval(sendLobbyWebHeartbeat, 14000);
            global.setInterval(loadHotelSettings, 120000);
            global.setInterval(pollGlobalAnnouncements, 25000);
        }
    };
})(window);

