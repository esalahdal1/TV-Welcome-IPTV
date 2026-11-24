(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var i18n = TVApp.i18n;
    var db = TVApp.db;
    var utils = TVApp.utils;
    var escapeHtml = utils.escapeHtml;

    var MAX_MEDIA_BYTES = 150 * 1024 * 1024;
    var defaultCastTab = (TVApp.webrtcCast && TVApp.webrtcCast.isScreenCaptureSupported()) ? 'webrtc' : 'media';

    var state = {
        room: cfg.ROOM || '101',
        pin: cfg.PIN_PARAM || '',
        verified: false,
        guestName: null,
        hotel: Object.assign({}, cfg.HOTEL_DEFAULTS),
        castTab: defaultCastTab,
        webrtcState: 'idle',
        webrtcMessage: '',
        webrtcIsError: false,
        mediaUploading: false,
        mediaProgress: 0,
        mediaMessage: '',
        mediaIsError: false,
        activeMedia: null,
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
            var pinField = $('mobPinInput');
            if (pinField) {
                pinField.placeholder = m.pinPlaceholder;
                if (state.pin && !pinField.value) pinField.value = state.pin;
            }
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
            tabsEl.innerHTML = ['webrtc', 'media', 'airplay', 'chromecast', 'hdmi'].map(function (key) {
                var active = key === state.castTab ? ' active' : '';
                return '<button type="button" class="mob-tab' + active + '" data-mob-cast="' + key + '">' +
                    escapeHtml(d.castTabs[key]) + '</button>';
            }).join('');
            tabsEl.querySelectorAll('button[data-mob-cast]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    state.castTab = btn.getAttribute('data-mob-cast') || defaultCastTab;
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

        var mediaBox = $('mobMediaBox');
        var mediaPickBtn = $('mobMediaPickBtn');
        var mediaProgWrap = $('mobMediaProgressWrap');
        var mediaProgBar = $('mobMediaProgressBar');
        var mediaProgText = $('mobMediaProgressText');
        var mediaControls = $('mobMediaControls');
        var mediaName = $('mobMediaActiveName');
        var mediaPP = $('mobMediaPlayPauseBtn');
        var mediaMute = $('mobMediaMuteBtn');
        var mediaStop = $('mobMediaStopBtn');
        var mediaNote = $('mobMediaNote');
        if (mediaBox) {
            mediaBox.style.display = state.castTab === 'media' ? 'grid' : 'none';
            if (mediaPickBtn) {
                mediaPickBtn.disabled = !!state.mediaUploading;
                mediaPickBtn.innerHTML = '<i class="fas fa-photo-video"></i><span>' +
                    escapeHtml(state.activeMedia ? m.mediaPickAnother : m.mediaPick) + '</span>';
            }
            if (mediaProgWrap && mediaProgBar && mediaProgText) {
                mediaProgWrap.style.display = state.mediaUploading ? 'flex' : 'none';
                mediaProgBar.style.width = state.mediaProgress + '%';
                mediaProgText.innerText = state.mediaProgress + '%';
            }
            if (mediaControls) {
                var activeM = state.activeMedia;
                mediaControls.style.display = activeM ? 'grid' : 'none';
                if (activeM) {
                    var isVid = activeM.kind === 'video';
                    if (mediaName) mediaName.innerText = m.mediaPlaying + ' ' + (activeM.filename || '');
                    if (mediaPP) {
                        mediaPP.style.display = isVid ? 'inline-flex' : 'none';
                        mediaPP.innerHTML = '<i class="fas ' + (activeM.paused ? 'fa-play' : 'fa-pause') + '"></i><span>' +
                            escapeHtml(activeM.paused ? m.mediaPlay : m.mediaPause) + '</span>';
                    }
                    if (mediaMute) {
                        mediaMute.style.display = isVid ? 'inline-flex' : 'none';
                        mediaMute.innerHTML = '<i class="fas ' + (activeM.muted ? 'fa-volume-up' : 'fa-volume-mute') + '"></i><span>' +
                            escapeHtml(activeM.muted ? m.mediaUnmute : m.mediaMute) + '</span>';
                    }
                    if (mediaStop) {
                        mediaStop.innerHTML = '<i class="fas fa-stop"></i><span>' + escapeHtml(m.mediaStop) + '</span>';
                    }
                }
            }
            if (mediaNote) {
                mediaNote.className = state.mediaIsError ? 'mob-webrtc-note is-error' : 'mob-webrtc-note';
                mediaNote.innerText = state.mediaMessage || '';
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
        var submitBtn = $('mobPinSubmit');
        if (!state.pin || !/^\d{4}$/.test(state.pin)) {
            state.verified = false;
            if (errEl) errEl.style.display = 'none';
            renderMobilePortal();
            return false;
        }
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = i18n.getLang() === 'en' ? 'Verifying...' : 'جارٍ التحقق...';
        }
        var res = await db.verifyGuestPin(state.room, state.pin);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = i18n.dict().mobile.pinSubmit;
        }
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

    function prepareImageForTv(file) {
        if (!file || file.type === 'image/gif') {
            return Promise.resolve({ blob: file, name: (file && file.name) || 'photo.gif' });
        }
        var urlApi = global.URL || global.webkitURL;
        if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
            return Promise.resolve({ blob: file, name: file.name || 'photo.jpg' });
        }
        return new Promise(function (resolve) {
            var objUrl = urlApi.createObjectURL(file);
            var img = new global.Image();
            img.onload = function () {
                try {
                    var maxDim = 1920;
                    var w = img.naturalWidth || img.width || 1280;
                    var h = img.naturalHeight || img.height || 720;
                    var scale = Math.min(1, maxDim / Math.max(w, h));
                    var tw = Math.max(1, Math.round(w * scale));
                    var th = Math.max(1, Math.round(h * scale));
                    var canvas = global.document.createElement('canvas');
                    canvas.width = tw;
                    canvas.height = th;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, tw, th);
                    canvas.toBlob(function (blob) {
                        urlApi.revokeObjectURL(objUrl);
                        if (blob) {
                            var baseName = String(file.name || 'photo').replace(/\.[^.]+$/, '');
                            resolve({ blob: blob, name: baseName + '.jpg' });
                        } else {
                            resolve({ blob: file, name: file.name || 'photo.jpg' });
                        }
                    }, 'image/jpeg', 0.9);
                } catch (e) {
                    urlApi.revokeObjectURL(objUrl);
                    resolve({ blob: file, name: file.name || 'photo.jpg' });
                }
            };
            img.onerror = function () {
                urlApi.revokeObjectURL(objUrl);
                resolve({ blob: file, name: file.name || 'photo.jpg' });
            };
            img.src = objUrl;
        });
    }

    async function refreshActiveMedia() {
        if (!state.verified || !db.getCurrentRoomMedia) return;
        var res = await db.getCurrentRoomMedia(state.room, state.pin);
        if (res) {
            state.activeMedia = res.active ? res.media : null;
            renderMobilePortal();
        }
    }

    async function handleMediaFileSelected(file) {
        if (!file || state.mediaUploading) return;
        var m = i18n.dict().mobile;
        var isImage = /^image\//i.test(file.type) || /\.(heic|heif|jpg|jpeg|png|webp|gif)$/i.test(file.name || '');
        var isVideo = /^video\//i.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name || '');
        if (!isImage && !isVideo) {
            state.mediaIsError = true;
            state.mediaMessage = m.mediaUnsupported;
            renderMobilePortal();
            return;
        }
        if (file.size > MAX_MEDIA_BYTES) {
            state.mediaIsError = true;
            state.mediaMessage = m.mediaTooLarge;
            renderMobilePortal();
            return;
        }

        state.mediaUploading = true;
        state.mediaProgress = 0;
        state.mediaIsError = false;
        state.mediaMessage = isImage ? m.mediaOptimizing : m.mediaUploading;
        renderMobilePortal();

        var uploadBlob = file;
        var uploadName = file.name || (isImage ? 'photo.jpg' : 'video.mp4');
        if (isImage) {
            var prep = await prepareImageForTv(file);
            uploadBlob = prep.blob;
            uploadName = prep.name;
            state.mediaMessage = i18n.dict().mobile.mediaUploading;
            renderMobilePortal();
        }

        var res = await db.uploadRoomMedia(state.room, state.pin, uploadBlob, uploadName, function (pct) {
            state.mediaProgress = pct;
            var bar = $('mobMediaProgressBar');
            var txt = $('mobMediaProgressText');
            if (bar) bar.style.width = pct + '%';
            if (txt) txt.innerText = pct + '%';
        });

        state.mediaUploading = false;
        if (res && res.ok && res.media) {
            state.activeMedia = res.media;
            state.mediaIsError = false;
            state.mediaMessage = '';
        } else {
            state.mediaIsError = true;
            state.mediaMessage = (res && res.error && res.error.message) || i18n.dict().mobile.mediaUploadFailed;
        }
        renderMobilePortal();
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

            var mediaPickBtn = $('mobMediaPickBtn');
            var mediaInput = $('mobMediaInput');
            if (mediaPickBtn && mediaInput) {
                mediaPickBtn.addEventListener('click', function () {
                    if (!state.mediaUploading) mediaInput.click();
                });
                mediaInput.addEventListener('change', function () {
                    var f = mediaInput.files && mediaInput.files[0];
                    mediaInput.value = '';
                    if (f) handleMediaFileSelected(f);
                });
            }

            var sendMediaAction = async function (action) {
                if (!db.controlRoomMedia) return;
                var res = await db.controlRoomMedia(state.room, state.pin, action);
                if (res && res.ok) {
                    state.activeMedia = res.active ? (res.media || state.activeMedia) : null;
                    renderMobilePortal();
                }
            };
            var mediaPP = $('mobMediaPlayPauseBtn');
            var mediaMute = $('mobMediaMuteBtn');
            var mediaStop = $('mobMediaStopBtn');
            if (mediaPP) {
                mediaPP.addEventListener('click', function () {
                    if (!state.activeMedia) return;
                    sendMediaAction(state.activeMedia.paused ? 'play' : 'pause');
                });
            }
            if (mediaMute) {
                mediaMute.addEventListener('click', function () {
                    if (!state.activeMedia) return;
                    sendMediaAction(state.activeMedia.muted ? 'unmute' : 'mute');
                });
            }
            if (mediaStop) {
                mediaStop.addEventListener('click', function () {
                    sendMediaAction('stop');
                });
            }

            var submitPin = async function () {
                var input = $('mobPinInput');
                state.pin = utils.normalizeDigits((input && input.value || '').trim());
                await verifyCurrentPin(true);
                refreshActiveMedia();
            };
            var pinBtn = $('mobPinSubmit');
            var pinInput = $('mobPinInput');
            if (pinBtn) pinBtn.addEventListener('click', submitPin);
            if (pinInput) pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPin(); });

            // Render immediately so mobile never hangs on a blank page while waiting on network
            renderMobilePortal();
            loadHotelInfo().then(renderMobilePortal);
            if (await verifyCurrentPin(!!state.pin)) {
                refreshActiveMedia();
            }

            // Poll periodically: expires mobile portal & stops WebRTC/media automatically if PIN rotated
            state.pollTimer = global.setInterval(async function () {
                if (state.verified) {
                    var ok = await verifyCurrentPin(true);
                    if (ok) {
                        loadHistory();
                        refreshActiveMedia();
                    } else {
                        state.activeMedia = null;
                        if (TVApp.webrtcCast && (state.webrtcState === 'connecting' || state.webrtcState === 'connected')) {
                            TVApp.webrtcCast.stopSender();
                        }
                    }
                }
            }, 25000);
        }
    };
})(window);

