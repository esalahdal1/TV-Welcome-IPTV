(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var i18n = TVApp.i18n;
    var db = TVApp.db;
    var utils = TVApp.utils;
    var escapeHtml = utils.escapeHtml;

    var state = {
        room: cfg.ROOM || '101',
        pin: cfg.PIN_PARAM || '',
        verified: false,
        guestName: null,
        hotel: Object.assign({}, cfg.HOTEL_DEFAULTS),
        castTab: 'webrtc',
        webrtcState: 'idle',
        webrtcMessage: '',
        webrtcIsError: false,
        pollTimer: null
    };

    function $(id) {
        return global.document.getElementById(id);
    }

    function formatShortTime(iso) {
        try {
            var locale = i18n.getLang() === 'en' ? 'en-US' : 'ar-SA';
            return new Intl.DateTimeFormat(locale, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Riyadh'
            }).format(new Date(iso));
        } catch (e) {
            return '';
        }
    }

    async function loadHotelInfo() {
        var remote = await db.fetchHotelSettings();
        if (remote) {
            state.hotel.wifiName = remote.wifi_name || state.hotel.wifiName;
            state.hotel.wifiPass = remote.wifi_pass || state.hotel.wifiPass;
            state.hotel.receptionExt = remote.reception_ext || state.hotel.receptionExt;
            state.hotel.breakfastHours = remote.breakfast_hours || state.hotel.breakfastHours;
            state.hotel.checkoutTime = remote.checkout_time || state.hotel.checkoutTime;
        }
    }

    async function loadHistory() {
        var listEl = $('mobHistoryList');
        if (!listEl || !state.verified) return;
        var rows = await db.listRoomRequests(state.room);
        var d = i18n.dict();
        if (!rows || rows.length === 0) {
            listEl.innerHTML = '<div class="mob-empty">' + escapeHtml(d.recentRequestsEmpty) + '</div>';
            return;
        }
        listEl.innerHTML = rows.map(function (r) {
            var done = r.status === 'done';
            var badgeCls = done ? 'mob-badge is-done' : 'mob-badge is-pending';
            var badgeTxt = done ? d.statusDone : d.statusPending;
            var label = i18n.translateRequestType(r.request_type || '');
            return '<div class="mob-history-row">' +
                '<div><div class="mob-history-title">' + escapeHtml(label) + '</div>' +
                '<div class="mob-history-time">' + escapeHtml(formatShortTime(r.created_at)) + '</div></div>' +
                '<span class="' + badgeCls + '">' + escapeHtml(badgeTxt) + '</span>' +
                '</div>';
        }).join('');
    }

    function renderMobilePortal() {
        var d = i18n.dict();
        var m = d.mobile;
        var lang = i18n.getLang();

        var langBtn = $('mobLangToggle');
        if (langBtn) langBtn.innerText = lang === 'ar' ? 'English' : 'العربية';

        var brandEl = $('mobBrandTitle');
        var subEl = $('mobSubtitle');
        var badgeEl = $('mobRoomBadge');
        var guestEl = $('mobGuestGreeting');
        if (brandEl) brandEl.innerText = d.hotelBrand;
        if (subEl) subEl.innerText = m.subtitle;
        if (badgeEl) badgeEl.innerText = m.roomBadge + ' ' + state.room;
        if (guestEl) guestEl.innerText = state.guestName || d.defaultGuest;

        var gate = $('mobPinGate');
        var content = $('mobPortalBody');
        if (gate) gate.style.display = state.verified ? 'none' : 'grid';
        if (content) content.style.display = state.verified ? 'grid' : 'none';

        if (!state.verified) {
            if ($('mobPinGateTitle')) $('mobPinGateTitle').innerText = m.pinGateTitle;
            if ($('mobPinGateDesc')) $('mobPinGateDesc').innerText = m.pinGateDesc;
            if ($('mobPinInput')) $('mobPinInput').placeholder = m.pinPlaceholder;
            if ($('mobPinSubmit')) $('mobPinSubmit').innerText = m.pinSubmit;
            return;
        }

        // Wi-Fi Card
        if ($('mobWifiTitle')) $('mobWifiTitle').innerText = m.wifiTitle;
        if ($('mobWifiSsid')) $('mobWifiSsid').innerText = state.hotel.wifiName;
        if ($('mobWifiPass')) $('mobWifiPass').innerText = state.hotel.wifiPass;
        if ($('mobCopyWifi')) $('mobCopyWifi').innerText = m.copyPass;

        // Services
        if ($('mobServicesTitle')) $('mobServicesTitle').innerText = m.servicesTitle;
        var servicesGrid = $('mobServicesGrid');
        if (servicesGrid) {
            servicesGrid.innerHTML = cfg.GUEST_REQUEST_TYPES.map(function (req, idx) {
                var lbl = lang === 'en' ? req.en : req.ar;
                return '<button type="button" class="mob-service-btn" data-mob-req="' + idx + '">' +
                    '<i class="fas ' + req.icon + '"></i><span>' + escapeHtml(lbl) + '</span></button>';
            }).join('');

            servicesGrid.querySelectorAll('button[data-mob-req]').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    var idx = Number(btn.getAttribute('data-mob-req') || '0') || 0;
                    var req = cfg.GUEST_REQUEST_TYPES[idx];
                    if (!req) return;
                    var statusEl = $('mobServiceStatus');
                    btn.disabled = true;
                    if (statusEl) {
                        statusEl.className = 'mob-status';
                        statusEl.innerText = d.servicesSending;
                    }
                    var res = await db.insertGuestRequest(state.room, req.ar);
                    btn.disabled = false;
                    if (res && res.error) {
                        if (statusEl) {
                            statusEl.className = 'mob-status is-error';
                            statusEl.innerText = d.servicesErrorPrefix + (res.error.message || '');
                        }
                        return;
                    }
                    if (statusEl) {
                        statusEl.className = 'mob-status';
                        statusEl.innerText = d.servicesSent;
                    }
                    loadHistory();
                });
            });
        }

        // History
        if ($('mobHistoryTitle')) $('mobHistoryTitle').innerText = m.historyTitle;
        loadHistory();

        // Casting Guide + WebRTC Sender
        if ($('mobCastTitle')) $('mobCastTitle').innerText = m.castTitle;
        var tabsEl = $('mobCastTabs');
        if (tabsEl) {
            tabsEl.innerHTML = ['webrtc', 'airplay', 'chromecast', 'hdmi'].map(function (key) {
                var active = key === state.castTab ? ' active' : '';
                return '<button type="button" class="mob-tab' + active + '" data-mob-cast="' + key + '">' +
                    escapeHtml(d.castTabs[key]) + '</button>';
            }).join('');
            tabsEl.querySelectorAll('button[data-mob-cast]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    state.castTab = btn.getAttribute('data-mob-cast') || 'webrtc';
                    renderMobilePortal();
                });
            });
        }

        var webrtcBox = $('mobWebrtcBox');
        var webrtcBtn = $('mobWebrtcBtn');
        var webrtcNote = $('mobWebrtcNote');
        if (webrtcBox && webrtcBtn && webrtcNote) {
            var canCapture = TVApp.webrtcCast && TVApp.webrtcCast.isScreenCaptureSupported();
            webrtcBox.style.display = state.castTab === 'webrtc' ? 'grid' : 'none';
            if (!canCapture) {
                webrtcBtn.style.display = 'none';
                webrtcNote.className = 'mob-webrtc-note';
                webrtcNote.innerText = m.webrtcUnsupported;
            } else {
                webrtcBtn.style.display = 'flex';
                var isActive = state.webrtcState === 'connecting' || state.webrtcState === 'connected';
                webrtcBtn.className = isActive ? 'mob-webrtc-btn is-stop' : 'mob-webrtc-btn';
                webrtcBtn.innerHTML = '<i class="fas ' + (isActive ? 'fa-stop-circle' : 'fa-tv') + '"></i><span>' +
                    escapeHtml(isActive ? m.webrtcStop : m.webrtcStart) + '</span>';
                webrtcNote.className = state.webrtcIsError ? 'mob-webrtc-note is-error' : 'mob-webrtc-note';
                webrtcNote.innerText = state.webrtcMessage || (state.webrtcState === 'connected' ? m.webrtcConnected : (state.webrtcState === 'connecting' ? m.webrtcConnecting : ''));
            }
        }

        var stepsEl = $('mobCastSteps');
        if (stepsEl) {
            var steps = d.castSteps[state.castTab] || [];
            stepsEl.innerHTML = steps.map(function (s, idx) {
                return '<div class="mob-step"><span class="mob-step-num">' + (idx + 1) + '</span><span>' + escapeHtml(s) + '</span></div>';
            }).join('');
        }
        if ($('mobActivePinVal')) $('mobActivePinVal').innerText = state.pin;

        // Guide Info
        if ($('mobGuideTitle')) $('mobGuideTitle').innerText = m.guideTitle;
        var guideEl = $('mobGuideList');
        if (guideEl) {
            var rows = [
                { k: d.guideLabels.reception, v: state.hotel.receptionExt },
                { k: d.guideLabels.breakfast, v: state.hotel.breakfastHours },
                { k: d.guideLabels.checkout, v: state.hotel.checkoutTime },
                { k: d.guideLabels.address, v: d.cityLabel }
            ];
            guideEl.innerHTML = rows.map(function (r) {
                return '<div class="mob-info-row"><span>' + escapeHtml(r.k) + '</span><strong>' + escapeHtml(r.v) + '</strong></div>';
            }).join('');
        }
    }

    async function verifyCurrentPin(showErrorIfFailed) {
        var errEl = $('mobPinError');
        if (!state.pin || !/^\d{4}$/.test(state.pin)) {
            state.verified = false;
            if (errEl) errEl.style.display = 'none';
            renderMobilePortal();
            return false;
        }
        var res = await db.verifyGuestPin(state.room, state.pin);
        if (res && res.valid) {
            state.verified = true;
            state.guestName = res.full_name || null;
            if (errEl) errEl.style.display = 'none';
            if (res.preferred_lang === 'ar' || res.preferred_lang === 'en') {
                i18n.setLang(res.preferred_lang);
            }
            renderMobilePortal();
            return true;
        }
        state.verified = false;
        if (errEl && showErrorIfFailed) {
            errEl.style.display = 'block';
            errEl.innerText = i18n.dict().mobile.pinInvalid;
        }
        renderMobilePortal();
        return false;
    }

    function copyPassword() {
        var btn = $('mobCopyWifi');
        var txt = state.hotel.wifiPass;
        var done = function () {
            if (!btn) return;
            btn.innerText = i18n.dict().mobile.copiedPass;
            global.setTimeout(function () {
                btn.innerText = i18n.dict().mobile.copyPass;
            }, 1600);
        };
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
            global.navigator.clipboard.writeText(txt).then(done).catch(function () {
                fallbackCopy(txt);
                done();
            });
        } else {
            fallbackCopy(txt);
            done();
        }
    }

    function fallbackCopy(txt) {
        var ta = global.document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        global.document.body.appendChild(ta);
        ta.select();
        try { global.document.execCommand('copy'); } catch (e) {}
        global.document.body.removeChild(ta);
    }

    TVApp.mobilePortal = {
        init: async function () {
            global.document.documentElement.classList.add('is-mobile-mode');
            global.document.body.classList.add('is-mobile-mode');
            i18n.setLang(i18n.getLang());

            var root = $('mobilePortalRoot');
            if (root) root.style.display = 'block';

            var langBtn = $('mobLangToggle');
            if (langBtn) {
                langBtn.addEventListener('click', function () {
                    i18n.toggleLang();
                    renderMobilePortal();
                });
            }

            var copyBtn = $('mobCopyWifi');
            if (copyBtn) copyBtn.addEventListener('click', copyPassword);

            var webrtcBtn = $('mobWebrtcBtn');
            if (webrtcBtn) {
                webrtcBtn.addEventListener('click', function () {
                    if (!TVApp.webrtcCast) return;
                    if (state.webrtcState === 'connecting' || state.webrtcState === 'connected') {
                        TVApp.webrtcCast.stopSender();
                        state.webrtcState = 'idle';
                        state.webrtcMessage = '';
                        state.webrtcIsError = false;
                        renderMobilePortal();
                        return;
                    }
                    state.webrtcMessage = '';
                    state.webrtcIsError = false;
                    TVApp.webrtcCast.startSender(state.room, state.pin, {
                        onState: function (st) {
                            var m = i18n.dict().mobile;
                            state.webrtcState = st === 'stopped' ? 'idle' : st;
                            state.webrtcIsError = false;
                            if (st === 'connecting') state.webrtcMessage = m.webrtcConnecting;
                            else if (st === 'connected') state.webrtcMessage = m.webrtcConnected;
                            else state.webrtcMessage = '';
                            renderMobilePortal();
                        },
                        onError: function (code) {
                            var m = i18n.dict().mobile;
                            state.webrtcState = 'idle';
                            state.webrtcIsError = true;
                            if (code === 'UNSUPPORTED') state.webrtcMessage = m.webrtcUnsupported;
                            else if (code === 'CANCELLED') state.webrtcMessage = m.webrtcCancelled;
                            else state.webrtcMessage = m.webrtcFailed;
                            renderMobilePortal();
                        }
                    });
                });
            }

            var submitPin = async function () {
                var input = $('mobPinInput');
                state.pin = utils.normalizeDigits((input && input.value || '').trim());
                await verifyCurrentPin(true);
            };
            var pinBtn = $('mobPinSubmit');
            var pinInput = $('mobPinInput');
            if (pinBtn) pinBtn.addEventListener('click', submitPin);
            if (pinInput) pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPin(); });

            await loadHotelInfo();
            await verifyCurrentPin(!!state.pin);

            // Poll periodically: expires mobile portal & stops WebRTC automatically if PIN rotated
            state.pollTimer = global.setInterval(async function () {
                if (state.verified) {
                    var ok = await verifyCurrentPin(true);
                    if (ok) {
                        loadHistory();
                    } else if (TVApp.webrtcCast && (state.webrtcState === 'connecting' || state.webrtcState === 'connected')) {
                        TVApp.webrtcCast.stopSender();
                    }
                }
            }, 25000);
        }
    };
})(window);

