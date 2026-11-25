(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var db = TVApp.db;
    var utils = TVApp.utils;
    var escapeHtml = utils.escapeHtml;

    var state = {
        pin: '',
        activeTab: 'rooms', // 'rooms' | 'requests' | 'notifications' | 'settings'
        reqFilter: 'pending',
        roomSearch: '',
        roomFilter: 'all', // 'all' | 'occupied' | 'vacant'
        guests: [],
        screens: [],
        iptvChannels: [],
        rpcActive: false,
        soundEnabled: true,
        knownPendingIds: null,
        pollTimer: null
    };

    function $(id) {
        return global.document.getElementById(id);
    }

    function formatDateTime(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            var ymd = new Intl.DateTimeFormat('en-CA', {
                year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Riyadh'
            }).format(d);
            var t = new Intl.DateTimeFormat('ar-SA', {
                hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh'
            }).format(d);
            return { date: ymd, time: t };
        } catch (e) {
            return { date: String(iso).slice(0, 10), time: '' };
        }
    }

    function playAlertChime() {
        if (!state.soundEnabled) return;
        var AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (!AudioCtx) return;
        try {
            var ctx = new AudioCtx();
            var now = ctx.currentTime;
            [660, 880].forEach(function (freq, idx) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.14);
                gain.gain.setValueAtTime(0.001, now + idx * 0.14);
                gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.14 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.28);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.14);
                osc.stop(now + idx * 0.14 + 0.3);
            });
        } catch (e) {}
    }

    function showStaffToast(msg, isError) {
        var box = $('staffToast');
        if (!box) return;
        box.innerText = msg;
        box.className = isError ? 'staff-toast is-error' : 'staff-toast';
        box.style.display = 'block';
        global.setTimeout(function () {
            box.style.display = 'none';
        }, 3800);
    }

    function setTab(tab) {
        state.activeTab = tab;
        document.querySelectorAll('[data-staff-tab]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-staff-tab') === tab);
        });
        document.querySelectorAll('[data-staff-pane]').forEach(function (pane) {
            pane.style.display = pane.getAttribute('data-staff-pane') === tab ? 'grid' : 'none';
        });

        if (tab === 'rooms') {
            loadRooms();
            loadScreensMonitor();
        }
        if (tab === 'screens') loadScreensMonitor();
        if (tab === 'requests') loadRequests();
        if (tab === 'notifications') loadNotificationsFeed();
        if (tab === 'channel1') loadChannel1Panel();
        if (tab === 'settings') loadSettingsForm();
    }

    function describeScreenActivity(code) {
        var map = {
            portal: 'واجهة الترحيب',
            live_tv: 'يشاهد القنوات',
            channels: 'قائمة القنوات',
            cast_media: 'بث وسائط من الجوال',
            cast_webrtc: 'مشاركة شاشة نشطة',
            lobby: 'شاشة صالة الفندق',
            setup: 'شاشة الإعداد',
            background: 'يعمل بالخلفية'
        };
        return map[code] || 'متصل';
    }

    function formatAgo(sec) {
        var s = Number(sec) || 0;
        if (s < 10) return 'الآن';
        if (s < 60) return 'منذ ' + s + ' ث';
        var m = Math.floor(s / 60);
        if (m < 60) return 'منذ ' + m + ' د';
        var h = Math.floor(m / 60);
        if (h < 24) return 'منذ ' + h + ' س';
        return 'منذ ' + Math.floor(h / 24) + ' يوم';
    }

    async function loadScreensMonitor() {
        if (!db.staffListScreens || !state.pin) return;
        var res = await db.staffListScreens(state.pin);
        if (!res || !res.ok) return;
        state.screens = Array.isArray(res.screens) ? res.screens : [];
        var badge = $('staffOnlineScreensBadge');
        if (badge) {
            badge.innerText = String(res.online_count || 0);
            badge.style.display = (res.total_count > 0) ? 'inline-flex' : 'none';
        }
        if (state.activeTab === 'screens') renderScreensMonitor(res);
        if (state.activeTab === 'rooms') renderRoomsList();
    }

    async function sendRemoteCmd(target, command, label) {
        if (!db.staffSendScreenCommand) return;
        var res = await db.staffSendScreenCommand(state.pin, target, command);
        if (res && res.ok) {
            showStaffToast('تم إرسال أمر «' + label + '» إلى ' + (target === 'all' ? ('جميع الشاشات (' + (res.queued || 0) + ')') : target), false);
            global.setTimeout(loadScreensMonitor, 2200);
        } else {
            showStaffToast((res && res.error && res.error.message) || 'تعذر إرسال الأمر', true);
        }
    }

    function renderScreensMonitor(res) {
        var box = $('staffScreensList');
        var statsEl = $('staffScreensStats');
        if (!box) return;
        var rows = state.screens;
        var onlineCount = res && typeof res.online_count === 'number' ? res.online_count : rows.filter(function (s) { return s.online; }).length;
        if (statsEl) {
            statsEl.innerText = 'الشاشات المسجلة: ' + rows.length + ' • متصلة الآن: ' + onlineCount + ' • غير متصلة: ' + Math.max(0, rows.length - onlineCount);
        }
        if (rows.length === 0) {
            box.innerHTML = '<div class="staff-empty">لم تتصل أي شاشة بعد. ستظهر هنا تلقائياً فور فتح تطبيق التلفزيون على أي شاشة في الشبكة.</div>';
            return;
        }
        box.innerHTML = rows.map(function (s) {
            var sid = String(s.screen_id || '');
            var isLobby = s.mode === 'lobby';
            var title = isLobby ? 'شاشة صالة / استقبال' : ('غرفة ' + (s.room || 'غير معيّنة'));
            var guestTxt = isLobby ? 'وضع الصالات العام' : (s.guest_name ? ('النزيل: ' + s.guest_name) : 'غرفة شاغرة');
            var actLabel = describeScreenActivity(s.screen_state);
            var statusPill = s.online
                ? '<span class="staff-tv-pill is-online">متصل • ' + escapeHtml(actLabel) + '</span>'
                : '<span class="staff-tv-pill is-offline">غير متصل</span>';
            var dotCls = s.online ? 'staff-dot is-online' : 'staff-dot is-offline';
            var cardCls = s.online ? 'staff-screen-card is-online' : 'staff-screen-card';
            var ver = s.app_version && s.app_version !== 'web' ? ('v' + s.app_version.replace(/^v/i, '')) : 'متصفح ويب';

            return '<div class="' + cardCls + '">' +
                '<div class="staff-screen-head">' +
                '<div class="staff-screen-title"><span class="' + dotCls + '"></span>' + escapeHtml(title) + '</div>' +
                statusPill +
                '</div>' +
                '<div class="staff-screen-meta">' +
                escapeHtml(guestTxt) + '<br>' +
                'IP: <strong dir="ltr">' + escapeHtml(s.ip || '—') + '</strong> • الإصدار: <strong>' + escapeHtml(ver) + '</strong> • آخر نبضة: ' + escapeHtml(formatAgo(s.seconds_ago)) +
                '</div>' +
                '<div class="staff-screen-btns">' +
                '<button type="button" class="admin-btn" data-remote-sid="' + escapeHtml(sid) + '" data-remote-cmd="reload" data-remote-lbl="إعادة تحميل">إعادة تحميل</button>' +
                '<button type="button" class="admin-btn secondary" data-remote-sid="' + escapeHtml(sid) + '" data-remote-cmd="open_tv" data-remote-lbl="تشغيل القنوات">تشغيل القنوات</button>' +
                '<button type="button" class="admin-btn secondary" data-remote-sid="' + escapeHtml(sid) + '" data-remote-cmd="open_portal" data-remote-lbl="واجهة الترحيب">واجهة الترحيب</button>' +
                '<button type="button" class="admin-btn secondary" data-remote-sid="' + escapeHtml(sid) + '" data-remote-cmd="update_apk" data-remote-lbl="تحديث التطبيق">تحديث APK</button>' +
                (!isLobby && s.room ? '<button type="button" class="admin-btn secondary" data-screen-notify="' + escapeHtml(s.room) + '">إشعار</button>' : '') +
                (!s.online ? '<button type="button" class="admin-btn danger" data-remove-sid="' + escapeHtml(sid) + '">حذف</button>' : '') +
                '</div>' +
                '</div>';
        }).join('');

        box.querySelectorAll('button[data-remote-sid]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                sendRemoteCmd(
                    btn.getAttribute('data-remote-sid') || '',
                    btn.getAttribute('data-remote-cmd') || 'reload',
                    btn.getAttribute('data-remote-lbl') || 'أمر'
                );
            });
        });
        box.querySelectorAll('button[data-screen-notify]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openNotifyModal(btn.getAttribute('data-screen-notify') || '');
            });
        });
        box.querySelectorAll('button[data-remove-sid]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var sid = btn.getAttribute('data-remove-sid') || '';
                if (!sid || !db.staffRemoveScreen) return;
                await db.staffRemoveScreen(state.pin, sid);
                loadScreensMonitor();
            });
        });
    }

    /* --- Tab 1: Rooms & Check-in / Check-out --- */
    async function loadRooms() {
        var list = $('staffRoomsList');
        if (!list) return;
        var res = await db.staffListGuests(state.pin);
        state.rpcActive = !!res.rpcActive;
        updateSecurityBadge();

        if (res.error) {
            list.innerHTML = '<div class="staff-empty">' + escapeHtml(res.error.message || 'فشل تحميل الغرف') + '</div>';
            return;
        }
        state.guests = Array.isArray(res.data) ? res.data : [];
        renderRoomsList();
    }

    function renderRoomsList() {
        var list = $('staffRoomsList');
        var countEl = $('staffRoomsStats');
        if (!list) return;

        var occupiedCount = 0;
        var vacantCount = 0;
        state.guests.forEach(function (g) {
            if (String(g.full_name || '').trim()) occupiedCount++;
            else vacantCount++;
        });
        if (countEl) {
            countEl.innerText = 'الإجمالي: ' + state.guests.length + ' | مشغولة: ' + occupiedCount + ' | شاغرة: ' + vacantCount;
        }

        var q = state.roomSearch.toLowerCase();
        var filtered = state.guests.filter(function (g) {
            var room = String(g.room_number || '').trim();
            var name = String(g.full_name || '').trim();
            var isOccupied = name.length > 0;
            if (state.roomFilter === 'occupied' && !isOccupied) return false;
            if (state.roomFilter === 'vacant' && isOccupied) return false;
            if (q && room.toLowerCase().indexOf(q) === -1 && name.toLowerCase().indexOf(q) === -1) return false;
            return true;
        });

        if (filtered.length === 0) {
            list.innerHTML = '<div class="staff-empty">لا توجد غرف مطابقة. اضغط «+ تسكين / إضافة غرفة» لإضافة غرفة.</div>';
            return;
        }

        list.innerHTML = filtered.map(function (g) {
            var room = String(g.room_number || '').trim();
            var name = String(g.full_name || '').trim();
            var isOccupied = name.length > 0;
            var lang = g.preferred_lang === 'en' ? 'EN' : 'AR';
            var pin = g.cast_pin || '—';
            var badge = isOccupied
                ? '<span class="staff-badge is-occupied">مشغولة</span>'
                : '<span class="staff-badge is-vacant">شاغرة</span>';
            var scr = state.screens.find(function (s) { return s.mode === 'room' && String(s.room) === room; });
            var tvBadge = '';
            if (scr) {
                tvBadge = scr.online
                    ? ' <span class="staff-tv-pill is-online"><span class="staff-dot is-online"></span>الشاشة متصلة (' + escapeHtml(describeScreenActivity(scr.screen_state)) + ')</span>'
                    : ' <span class="staff-tv-pill is-offline">الشاشة غير متصلة</span>';
            }

            return '<div class="staff-room-row">' +
                '<div class="staff-room-num">' + escapeHtml(room) + '</div>' +
                '<div class="staff-room-guest">' +
                '<div class="staff-guest-title">' + escapeHtml(isOccupied ? name : 'غرفة شاغرة') + ' ' + badge + tvBadge + '</div>' +
                '<div class="staff-guest-meta">PIN: <strong>' + escapeHtml(pin) + '</strong> • اللغة: ' + escapeHtml(lang) + '</div>' +
                '</div>' +
                '<div class="staff-row-actions">' +
                '<button type="button" class="admin-btn" data-checkin-room="' + escapeHtml(room) + '">تسكين / تعديل</button>' +
                (isOccupied ? '<button type="button" class="admin-btn danger" data-checkout-room="' + escapeHtml(room) + '">مغادرة</button>' : '') +
                '<button type="button" class="admin-btn secondary" data-notify-room="' + escapeHtml(room) + '">إشعار</button>' +
                '</div>' +
                '</div>';
        }).join('');

        list.querySelectorAll('button[data-checkin-room]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var r = btn.getAttribute('data-checkin-room') || '';
                var found = state.guests.find(function (x) { return String(x.room_number).trim() === r; });
                openCheckinModal(r, found ? found.full_name : '', found ? found.preferred_lang : 'ar');
            });
        });

        list.querySelectorAll('button[data-checkout-room]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var r = btn.getAttribute('data-checkout-room') || '';
                if (!r) return;
                if (!global.confirm('تأكيد تسجيل خروج غرفة ' + r + '؟ سيتم مسح اسم النزيل وتغيير رمز PIN الغرفة تلقائيًا.')) return;
                btn.disabled = true;
                var res = await db.staffCheckoutGuest(state.pin, r);
                btn.disabled = false;
                if (res.error) {
                    showStaffToast(res.error.message || 'فشل تسجيل المغادرة', true);
                    return;
                }
                var newPin = res.data && res.data.cast_pin ? res.data.cast_pin : '';
                showStaffToast('تم تسجيل مغادرة غرفة ' + r + (newPin ? ' • رمز PIN الجديد: ' + newPin : ''), false);
                loadRooms();
            });
        });

        list.querySelectorAll('button[data-notify-room]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openNotifyModal(btn.getAttribute('data-notify-room') || '');
            });
        });
    }

    function openCheckinModal(room, guestName, lang) {
        var modal = $('checkinModal');
        var roomInput = $('checkinRoomInput');
        var nameInput = $('checkinNameInput');
        var langSelect = $('checkinLangSelect');
        var status = $('checkinStatus');
        if (!modal) return;
        if (roomInput) {
            roomInput.value = room || '';
            roomInput.readOnly = !!room;
        }
        if (nameInput) nameInput.value = guestName || '';
        if (langSelect) langSelect.value = lang === 'en' ? 'en' : 'ar';
        if (status) status.innerText = '';
        modal.style.display = 'flex';
        global.setTimeout(function () {
            if (room && nameInput) nameInput.focus();
            else if (roomInput) roomInput.focus();
        }, 40);
    }

    function closeCheckinModal() {
        var modal = $('checkinModal');
        if (modal) modal.style.display = 'none';
    }

    async function saveCheckinModal() {
        var roomInput = $('checkinRoomInput');
        var nameInput = $('checkinNameInput');
        var langSelect = $('checkinLangSelect');
        var status = $('checkinStatus');

        var room = utils.normalizeDigits((roomInput && roomInput.value || '').trim());
        var name = (nameInput && nameInput.value || '').trim();
        var lang = (langSelect && langSelect.value) === 'en' ? 'en' : 'ar';

        if (!room) {
            if (status) status.innerText = 'يرجى إدخال رقم الغرفة';
            return;
        }
        if (status) status.innerText = 'جارٍ الحفظ...';
        var res = await db.staffCheckinGuest(state.pin, room, name, lang);
        if (res.error) {
            if (status) status.innerText = res.error.message || 'فشل الحفظ';
            return;
        }
        var newPin = res.data && res.data.cast_pin ? res.data.cast_pin : '';
        closeCheckinModal();
        showStaffToast('تم حفظ بيانات غرفة ' + room + (newPin ? ' • PIN: ' + newPin : ''), false);
        loadRooms();
    }

    /* --- Tab 2: Requests Management --- */
    async function refreshPendingBadgeAndAlerts() {
        var res = await db.listRequestsByStatus('pending');
        if (res.error || !Array.isArray(res.data)) return;
        var rows = res.data;
        var badge = $('staffPendingBadge');
        if (badge) {
            badge.innerText = String(rows.length);
            badge.style.display = rows.length > 0 ? 'inline-flex' : 'none';
        }

        var currentIds = rows.map(function (r) { return r.id; });
        if (state.knownPendingIds !== null) {
            var hasNew = currentIds.some(function (id) {
                return state.knownPendingIds.indexOf(id) === -1;
            });
            if (hasNew) {
                playAlertChime();
                showStaffToast('وصل طلب جديد من أحد النزلاء!', false);
            }
        }
        state.knownPendingIds = currentIds;
        if (state.activeTab === 'requests' && state.reqFilter === 'pending') {
            renderRequestsRows(rows);
        }
    }

    function renderRequestsRows(rows) {
        var table = $('requestsTable');
        if (!table) return;
        var head = '<div class="req-row head">' +
            '<div class="req-cell req-type">طلب</div>' +
            '<div class="req-cell req-room">رقم الشقة</div>' +
            '<div class="req-cell req-date">تاريخ الطلب</div>' +
            '<div class="req-cell req-time">الساعة</div>' +
            '<div class="req-cell"> </div>' +
            '</div>';

        if (!rows || rows.length === 0) {
            table.innerHTML = head + '<div class="req-row"><div class="req-cell req-type">لا يوجد</div><div class="req-cell"></div><div class="req-cell"></div><div class="req-cell"></div><div class="req-cell"></div></div>';
            return;
        }

        table.innerHTML = head + rows.map(function (r) {
            var id = String(r.id || '').trim();
            var type = String(r.request_type || '').trim() || '—';
            var room = String(r.room_number || '').trim() || '—';
            var dt = formatDateTime(r.created_at);
            var btn = state.reqFilter === 'pending'
                ? '<button type="button" class="admin-btn" data-done="' + escapeHtml(id) + '">تم الإكمال</button>'
                : '<span class="staff-badge is-vacant">مكتمل</span>';
            return '<div class="req-row">' +
                '<div class="req-cell req-type">' + escapeHtml(type) + '</div>' +
                '<div class="req-cell req-room">' + escapeHtml(room) + '</div>' +
                '<div class="req-cell req-date">' + escapeHtml(dt.date) + '</div>' +
                '<div class="req-cell req-time">' + escapeHtml(dt.time) + '</div>' +
                '<div class="req-cell">' + btn + '</div>' +
                '</div>';
        }).join('');

        table.querySelectorAll('button[data-done]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var id = (btn.getAttribute('data-done') || '').trim();
                if (!id) return;
                btn.disabled = true;
                var res2 = await db.staffCompleteRequest(state.pin, id);
                if (res2.error) {
                    btn.disabled = false;
                    showStaffToast(res2.error.message || 'فشل التحديث', true);
                    return;
                }
                loadRequests();
                refreshPendingBadgeAndAlerts();
            });
        });
    }

    async function loadRequests() {
        var table = $('requestsTable');
        if (!table) return;
        var res = await db.listRequestsByStatus(state.reqFilter);
        if (res.error) {
            showStaffToast(res.error.message || 'فشل تحميل الطلبات', true);
            return;
        }
        renderRequestsRows(res.data || []);
    }

    /* --- Tab 3: Notifications --- */
    function openNotifyModal(targetRoom) {
        var modal = $('adminModal');
        var title = $('adminModalTitle');
        var msg = $('adminMsg');
        var status = $('adminStatus');
        if (!modal || !title || !msg || !status) return;
        modal.style.display = 'flex';
        title.innerText = targetRoom ? 'إرسال إشعار — شقة ' + targetRoom : 'إرسال إشعار للكل';
        msg.value = '';
        msg.dataset.room = targetRoom || '';
        status.innerText = '';
        global.setTimeout(function () { msg.focus(); }, 40);
    }

    function closeNotifyModal() {
        var modal = $('adminModal');
        if (modal) modal.style.display = 'none';
    }

    async function sendNotificationFromModal() {
        var msg = $('adminMsg');
        var status = $('adminStatus');
        var text = (msg && msg.value || '').trim();
        if (!text) return;
        var room = (msg && msg.dataset.room || '').trim();
        if (status) status.innerText = 'جارٍ الإرسال...';
        var res = await db.staffSendNotification(state.pin, room, text);
        if (res.error) {
            if (status) status.innerText = res.error.message || 'فشل الإرسال';
            return;
        }
        if (status) status.innerText = 'تم الإرسال';
        global.setTimeout(function () {
            closeNotifyModal();
            if (state.activeTab === 'notifications') loadNotificationsFeed();
        }, 500);
    }

    async function loadNotificationsFeed() {
        var list = $('staffNotifFeed');
        if (!list) return;
        var res = await db.staffListNotifications(state.pin);
        if (res.error) {
            list.innerHTML = '<div class="staff-empty">' + escapeHtml(res.error.message || 'فشل التحميل') + '</div>';
            return;
        }
        var rows = Array.isArray(res.data) ? res.data : [];
        if (rows.length === 0) {
            list.innerHTML = '<div class="staff-empty">لا توجد إشعارات مسجلة بعد.</div>';
            return;
        }
        list.innerHTML = rows.map(function (n) {
            var dt = formatDateTime(n.created_at);
            var target = n.room_number ? 'شقة ' + n.room_number : 'الكل';
            return '<div class="staff-notif-row">' +
                '<span class="staff-badge is-occupied">' + escapeHtml(target) + '</span>' +
                '<span class="staff-notif-msg">' + escapeHtml(n.message || '') + '</span>' +
                '<span class="staff-notif-time">' + escapeHtml(dt.date + ' ' + dt.time) + '</span>' +
                '</div>';
        }).join('');
    }

    /* --- Tab 4: Persistent Hotel Channel 1 Video --- */
    function formatFileSizeMb(bytes) {
        var b = Number(bytes) || 0;
        return (b / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderChannel1State(res) {
        var titleIn = $('ch1TitleInput');
        var status = $('ch1Status');
        var preview = $('ch1PreviewWrap');
        var video = $('ch1PreviewVideo');
        var metaEl = $('ch1MetaText');
        if (!res || !res.active || !res.channel) {
            if (titleIn && !titleIn.value) titleIn.value = 'مساكن النزهة — القناة الترحيبية';
            if (preview) preview.style.display = 'none';
            if (video) {
                try { video.pause(); } catch (e) {}
                video.removeAttribute('src');
            }
            if (metaEl) metaEl.innerText = '';
            if (status && !status.innerText) {
                status.innerText = 'لا يوجد فيديو مثبّت حالياً للقناة رقم 1.';
            }
            return;
        }
        var ch = res.channel;
        if (titleIn) titleIn.value = ch.title || 'مساكن النزهة — القناة الترحيبية';
        if (preview) preview.style.display = 'grid';
        if (video && ch.url && video.getAttribute('src') !== ch.url) {
            video.src = ch.url;
        }
        if (metaEl) {
            metaEl.innerText = 'مثبّت في السيرفر: ' + (ch.filename || 'welcome.mp4') + ' • ' + formatFileSizeMb(ch.size);
        }
        if (status) {
            status.innerText = 'القناة رقم 1 نشطة ومثبّتة داخل السيرفر وتعمل على الشاشات بدون إنترنت.';
        }
    }

    async function loadIptvChannels() {
        if (!db.staffListChannels || !state.pin) return;
        var res = await db.staffListChannels(state.pin);
        if (res && res.ok && Array.isArray(res.channels)) {
            state.iptvChannels = res.channels;
            renderIptvChannels();
        }
    }

    async function persistIptvChannels(toastMsg) {
        if (!db.staffSaveChannels) return;
        var res = await db.staffSaveChannels(state.pin, state.iptvChannels);
        if (res && res.ok && Array.isArray(res.channels)) {
            state.iptvChannels = res.channels;
            renderIptvChannels();
            if (toastMsg) showStaffToast(toastMsg, false);
        } else {
            showStaffToast((res && res.error && res.error.message) || 'تعذر حفظ القنوات', true);
        }
    }

    function renderIptvChannels() {
        var box = $('iptvChannelsList');
        var sum = $('iptvCountSummary');
        if (!box) return;
        var enabledCount = state.iptvChannels.filter(function (c) { return c.enabled !== false; }).length;
        if (sum) {
            sum.innerText = 'القنوات الفضائية المرتبة: ' + state.iptvChannels.length + ' قناة (المفعّل منها على الشاشات: ' + enabledCount + ' قناة بعد قناة الفندق #1).';
        }
        if (state.iptvChannels.length === 0) {
            box.innerHTML = '<div class="staff-empty">لا توجد قنوات مضافة. اضغط «استعادة القائمة الافتراضية» لتحميل القنوات السعودية والعربية.</div>';
            return;
        }
        box.innerHTML = state.iptvChannels.map(function (c, idx) {
            var enabled = c.enabled !== false;
            var chNum = idx + 2;
            var numStr = '#' + (chNum < 10 ? '0' + chNum : chNum);
            return '<div class="staff-iptv-row' + (enabled ? '' : ' is-disabled') + '">' +
                '<div class="staff-iptv-num">' + numStr + '</div>' +
                '<div class="staff-iptv-info">' +
                '<div class="staff-iptv-name">' + escapeHtml(c.name || '') + ' <span class="staff-iptv-group">' + escapeHtml(c.group || 'عامة') + '</span></div>' +
                '<div class="staff-iptv-url">' + escapeHtml(c.url || '') + '</div>' +
                '</div>' +
                '<div class="staff-iptv-actions">' +
                '<button type="button" class="admin-btn ' + (enabled ? '' : 'secondary') + '" data-ch-toggle="' + idx + '">' + (enabled ? 'مفعّلة ✓' : 'مخفية') + '</button>' +
                '<button type="button" class="admin-btn secondary" data-ch-up="' + idx + '"' + (idx === 0 ? ' disabled' : '') + '>▲</button>' +
                '<button type="button" class="admin-btn secondary" data-ch-down="' + idx + '"' + (idx === state.iptvChannels.length - 1 ? ' disabled' : '') + '>▼</button>' +
                '<button type="button" class="admin-btn danger" data-ch-del="' + idx + '">حذف</button>' +
                '</div>' +
                '</div>';
        }).join('');

        box.querySelectorAll('button[data-ch-toggle]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var i = Number(btn.getAttribute('data-ch-toggle'));
                if (!state.iptvChannels[i]) return;
                state.iptvChannels[i].enabled = state.iptvChannels[i].enabled === false;
                persistIptvChannels('تم تحديث حالة القناة');
            });
        });
        box.querySelectorAll('button[data-ch-up]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var i = Number(btn.getAttribute('data-ch-up'));
                if (i <= 0 || !state.iptvChannels[i]) return;
                var tmp = state.iptvChannels[i - 1];
                state.iptvChannels[i - 1] = state.iptvChannels[i];
                state.iptvChannels[i] = tmp;
                persistIptvChannels('تم تقديم ترتيب القناة');
            });
        });
        box.querySelectorAll('button[data-ch-down]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var i = Number(btn.getAttribute('data-ch-down'));
                if (i < 0 || i >= state.iptvChannels.length - 1) return;
                var tmp = state.iptvChannels[i + 1];
                state.iptvChannels[i + 1] = state.iptvChannels[i];
                state.iptvChannels[i] = tmp;
                persistIptvChannels('تم تأخير ترتيب القناة');
            });
        });
        box.querySelectorAll('button[data-ch-del]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var i = Number(btn.getAttribute('data-ch-del'));
                if (!state.iptvChannels[i]) return;
                state.iptvChannels.splice(i, 1);
                persistIptvChannels('تم حذف القناة من القائمة');
            });
        });
    }

    async function loadChannel1Panel() {
        var status = $('ch1Status');
        if (status) status.innerText = 'جارٍ التحقق من حالة القناة الأولى...';
        loadIptvChannels();
        if (!db.getHotelChannel1Info) return;
        var res = await db.getHotelChannel1Info();
        if (!res) {
            if (status) status.innerText = 'هذه الميزة تتطلب تشغيل خادم الفندق المحلي (Proxmox / المكتب).';
            return;
        }
        renderChannel1State(res);
    }

    async function uploadChannel1File(file) {
        if (!file) return;
        var isVid = /^video\//i.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name || '');
        var status = $('ch1Status');
        var progWrap = $('ch1ProgressWrap');
        var progBar = $('ch1ProgressBar');
        var progTxt = $('ch1ProgressText');
        var btn = $('ch1UploadBtn');
        if (!isVid) {
            showStaffToast('يرجى اختيار ملف فيديو صالح (MP4 / MOV / WebM)', true);
            return;
        }
        if (file.size > 500 * 1024 * 1024) {
            showStaffToast('حجم الفيديو يتجاوز 500 ميجابايت.', true);
            return;
        }
        var title = ($('ch1TitleInput') && $('ch1TitleInput').value || '').trim();
        if (btn) btn.disabled = true;
        if (progWrap) progWrap.style.display = 'flex';
        if (progBar) progBar.style.width = '0%';
        if (progTxt) progTxt.innerText = '0%';
        if (status) status.innerText = 'جارٍ رفع وتثبيت الفيديو داخل السيرفر...';

        var res = await db.uploadHotelChannel1Video(state.pin, title, file, file.name, function (pct) {
            if (progBar) progBar.style.width = pct + '%';
            if (progTxt) progTxt.innerText = pct + '%';
        });
        if (btn) btn.disabled = false;
        if (progWrap) progWrap.style.display = 'none';

        if (res && res.ok) {
            renderChannel1State(res);
            showStaffToast('تم تثبيت الفيديو كقناة رقم 1 بنجاح!', false);
        } else {
            var errMsg = (res && res.error && res.error.message) || 'تعذر رفع الفيديو';
            if (status) status.innerText = errMsg;
            showStaffToast(errMsg, true);
        }
    }

    /* --- Tab 5: Hotel Settings & Security --- */
    function renderApkInfo(info) {
        var metaEl = $('apkMetaText');
        var linkEl = $('apkDownloadLink');
        if (!metaEl) return;
        if (!info || !info.available) {
            metaEl.innerText = 'لا توجد نسخة APK مرفوعة بعد — ارفع ملف التطبيق ليكون متاحاً على /masaken.apk.';
            if (linkEl) linkEl.style.opacity = '0.5';
            return;
        }
        var mb = ((Number(info.size) || 0) / (1024 * 1024)).toFixed(1);
        metaEl.innerText = 'متوفر على السيرفر (' + mb + ' MB) • رابط التثبيت للشاشات: ' + global.location.origin + '/masaken.apk';
        if (linkEl) {
            linkEl.style.opacity = '1';
            linkEl.href = '/masaken.apk?t=' + Date.now();
        }
    }

    async function loadApkInfo() {
        if (!db.getLocalApkInfo) return;
        var info = await db.getLocalApkInfo();
        renderApkInfo(info);
    }

    async function uploadApkFile(file) {
        if (!file || !db.uploadLocalApk) return;
        if (!/\.apk$/i.test(file.name || '')) {
            showStaffToast('يرجى اختيار ملف بصيغة .apk', true);
            return;
        }
        var btn = $('apkUploadBtn');
        var progWrap = $('apkProgressWrap');
        var progBar = $('apkProgressBar');
        var progTxt = $('apkProgressText');
        var status = $('apkUploadStatus');
        if (btn) btn.disabled = true;
        if (progWrap) progWrap.style.display = 'flex';
        if (progBar) progBar.style.width = '0%';
        if (progTxt) progTxt.innerText = '0%';
        if (status) status.innerText = 'جارٍ رفع نسخة APK إلى السيرفر...';

        var res = await db.uploadLocalApk(state.pin, file, file.name, function (pct) {
            if (progBar) progBar.style.width = pct + '%';
            if (progTxt) progTxt.innerText = pct + '%';
        });
        if (btn) btn.disabled = false;
        if (progWrap) progWrap.style.display = 'none';

        if (res && res.ok) {
            if (status) status.innerText = 'تم حفظ نسخة APK على /masaken.apk بنجاح';
            renderApkInfo(res);
            showStaffToast('تم تحديث ملف APK المحلي للشاشات بنجاح!', false);
        } else {
            var msg = (res && res.error && res.error.message) || 'تعذر رفع ملف APK';
            if (status) status.innerText = msg;
            showStaffToast(msg, true);
        }
    }

    async function loadSettingsForm() {
        var h = cfg.HOTEL_DEFAULTS;
        var remote = await db.fetchHotelSettings();
        if ($('setWifiName')) $('setWifiName').value = (remote && remote.wifi_name) || h.wifiName;
        if ($('setWifiPass')) $('setWifiPass').value = (remote && remote.wifi_pass) || h.wifiPass;
        if ($('setReceptionExt')) $('setReceptionExt').value = (remote && remote.reception_ext) || h.receptionExt;
        if ($('setBreakfast')) $('setBreakfast').value = (remote && remote.breakfast_hours) || h.breakfastHours;
        if ($('setCheckout')) $('setCheckout').value = (remote && remote.checkout_time) || h.checkoutTime;
        if ($('setIptvM3u')) $('setIptvM3u').value = (remote && remote.iptv_m3u_url) || '';
        loadApkInfo();
    }

    async function saveHotelSettings() {
        var status = $('settingsSaveStatus');
        if (status) status.innerText = 'جارٍ الحفظ...';
        var res = await db.staffUpdateHotelSettings(state.pin, {
            wifi_name: ($('setWifiName') && $('setWifiName').value || '').trim(),
            wifi_pass: ($('setWifiPass') && $('setWifiPass').value || '').trim(),
            reception_ext: ($('setReceptionExt') && $('setReceptionExt').value || '').trim(),
            breakfast_hours: ($('setBreakfast') && $('setBreakfast').value || '').trim(),
            checkout_time: ($('setCheckout') && $('setCheckout').value || '').trim(),
            iptv_m3u_url: ($('setIptvM3u') && $('setIptvM3u').value || '').trim()
        });
        if (res.error) {
            if (status) status.innerText = res.error.message || 'فشل الحفظ';
            return;
        }
        if (status) status.innerText = 'تم حفظ إعدادات الفندق وتحديثها للشاشات';
        showStaffToast('تم تحديث إعدادات الفندق بنجاح', false);
    }

    async function changeStaffPin() {
        var oldEl = $('pinOldInput');
        var newEl = $('pinNewInput');
        var status = $('pinChangeStatus');
        var oldPin = utils.normalizeDigits((oldEl && oldEl.value || '').trim());
        var newPin = utils.normalizeDigits((newEl && newEl.value || '').trim());
        if (!oldPin || newPin.length < 4) {
            if (status) status.innerText = 'أدخل الرمز الحالي ورمزًا جديدًا لا يقل عن 4 أرقام.';
            return;
        }
        if (status) status.innerText = 'جارٍ التحديث...';
        var res = await db.staffChangePin(oldPin, newPin);
        if (res.error) {
            if (status) status.innerText = res.error.message || 'تعذر التغيير';
            return;
        }
        state.pin = newPin;
        try { global.sessionStorage.setItem('STAFF_PIN', newPin); } catch (e) {}
        if (oldEl) oldEl.value = '';
        if (newEl) newEl.value = '';
        if (status) status.innerText = 'تم تغيير رمز الموظفين بنجاح';
    }

    function updateSecurityBadge() {
        var el = $('staffSecurityBadge');
        if (!el) return;
        if (db.isLocalMode && db.isLocalMode()) {
            el.className = 'staff-sec-badge is-secure';
            el.innerText = 'وضع خادم المكتب المحلي متصل (تخزين تلقائي في local_hotel_db.json)';
        } else if (state.rpcActive) {
            el.className = 'staff-sec-badge is-secure';
            el.innerText = 'الحماية الخادمية (Supabase RPC + RLS) مفعّلة';
        } else {
            el.className = 'staff-sec-badge is-legacy';
            el.innerText = 'وضع المعاينة التمهيدي (شغّل SQL المرحلة 2 و3 لتفعيل القفل الكامل)';
        }
    }

    function enterConsole(pin, rpcActive) {
        state.pin = pin;
        state.rpcActive = !!rpcActive;
        try { global.sessionStorage.setItem('STAFF_PIN', pin); } catch (e) {}
        if ($('staffLoginBox')) $('staffLoginBox').style.display = 'none';
        if ($('staffDashboard')) $('staffDashboard').style.display = 'grid';
        updateSecurityBadge();
        setTab(state.activeTab);
        refreshPendingBadgeAndAlerts();
        loadScreensMonitor();
        if (!state.pollTimer) {
            state.pollTimer = global.setInterval(function () {
                refreshPendingBadgeAndAlerts();
                loadScreensMonitor();
                if (state.activeTab === 'rooms') loadRooms();
            }, 8000);
        }
    }

    function logout() {
        state.pin = '';
        if (state.pollTimer) {
            global.clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
        try { global.sessionStorage.removeItem('STAFF_PIN'); } catch (e) {}
        if ($('staffDashboard')) $('staffDashboard').style.display = 'none';
        if ($('staffLoginBox')) $('staffLoginBox').style.display = 'block';
        if ($('staffPassInput')) $('staffPassInput').value = '';
    }

    TVApp.staff = {
        init: async function (defaultTab) {
            global.document.documentElement.classList.add('is-mobile-mode');
            global.document.body.classList.add('is-mobile-mode');
            state.activeTab = defaultTab || 'rooms';

            var pass = $('staffPassInput');
            var loginBtn = $('staffLoginBtn');
            var loginErr = $('staffLoginErr');

            var tryLogin = async function (candidatePin) {
                var code = utils.normalizeDigits((candidatePin != null ? candidatePin : (pass && pass.value || '')).trim());
                var res = await db.staffLogin(code);
                if (!res.ok) {
                    if (loginErr) {
                        loginErr.style.display = 'block';
                        loginErr.innerText = 'الرمز غير صحيح';
                    }
                    return;
                }
                if (loginErr) loginErr.style.display = 'none';
                enterConsole(code, res.rpcActive);
            };

            if (loginBtn) loginBtn.addEventListener('click', function () { tryLogin(); });
            if (pass) pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });

            document.querySelectorAll('[data-staff-tab]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    setTab(btn.getAttribute('data-staff-tab'));
                });
            });

            if ($('staffRoomSearch')) {
                $('staffRoomSearch').addEventListener('input', function (e) {
                    state.roomSearch = e.target.value || '';
                    renderRoomsList();
                });
            }
            document.querySelectorAll('[data-room-filter]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    state.roomFilter = btn.getAttribute('data-room-filter') || 'all';
                    document.querySelectorAll('[data-room-filter]').forEach(function (b) {
                        b.classList.toggle('active', b === btn);
                    });
                    renderRoomsList();
                });
            });

            if ($('staffAddRoomBtn')) $('staffAddRoomBtn').addEventListener('click', function () { openCheckinModal('', '', 'ar'); });
            if ($('checkinCancelBtn')) $('checkinCancelBtn').addEventListener('click', closeCheckinModal);
            if ($('checkinSaveBtn')) $('checkinSaveBtn').addEventListener('click', saveCheckinModal);
            if ($('checkinModal')) $('checkinModal').addEventListener('click', function (e) { if (e.target === $('checkinModal')) closeCheckinModal(); });

            if ($('tabPending')) $('tabPending').addEventListener('click', function () {
                state.reqFilter = 'pending';
                $('tabPending').classList.add('active');
                if ($('tabDone')) $('tabDone').classList.remove('active');
                loadRequests();
            });
            if ($('tabDone')) $('tabDone').addEventListener('click', function () {
                state.reqFilter = 'done';
                $('tabDone').classList.add('active');
                if ($('tabPending')) $('tabPending').classList.remove('active');
                loadRequests();
            });

            if ($('staffSoundToggle')) $('staffSoundToggle').addEventListener('click', function () {
                state.soundEnabled = !state.soundEnabled;
                $('staffSoundToggle').innerText = state.soundEnabled ? 'التنبيه الصوتي: مفعّل' : 'التنبيه الصوتي: صامت';
            });

            if ($('adminSendAll')) $('adminSendAll').addEventListener('click', function () { openNotifyModal(''); });
            if ($('adminCancel')) $('adminCancel').addEventListener('click', closeNotifyModal);
            if ($('adminSend')) $('adminSend').addEventListener('click', sendNotificationFromModal);
            if ($('adminModal')) $('adminModal').addEventListener('click', function (e) { if (e.target === $('adminModal')) closeNotifyModal(); });

            if ($('ch1UploadBtn') && $('ch1VideoInput')) {
                $('ch1UploadBtn').addEventListener('click', function () {
                    $('ch1VideoInput').click();
                });
                $('ch1VideoInput').addEventListener('change', function () {
                    var f = $('ch1VideoInput').files && $('ch1VideoInput').files[0];
                    $('ch1VideoInput').value = '';
                    if (f) uploadChannel1File(f);
                });
            }
            if ($('ch1SaveTitleBtn')) {
                $('ch1SaveTitleBtn').addEventListener('click', async function () {
                    var title = ($('ch1TitleInput') && $('ch1TitleInput').value || '').trim();
                    if (!title || !db.updateHotelChannel1Title) return;
                    var res = await db.updateHotelChannel1Title(state.pin, title);
                    if (res && res.ok) {
                        renderChannel1State(res);
                        showStaffToast('تم تحديث اسم القناة رقم 1', false);
                    } else {
                        showStaffToast((res && res.error && res.error.message) || 'تعذر حفظ الاسم', true);
                    }
                });
            }
            if ($('ch1DeleteBtn')) {
                $('ch1DeleteBtn').addEventListener('click', async function () {
                    if (!global.confirm('تأكيد حذف فيديو القناة رقم 1 من السيرفر؟')) return;
                    if (!db.deleteHotelChannel1Video) return;
                    var res = await db.deleteHotelChannel1Video(state.pin);
                    if (res && res.ok) {
                        if ($('ch1Status')) $('ch1Status').innerText = '';
                        renderChannel1State(res);
                        showStaffToast('تم حذف فيديو القناة رقم 1', false);
                    } else {
                        showStaffToast((res && res.error && res.error.message) || 'تعذر الحذف', true);
                    }
                });
            }
            document.querySelectorAll('[data-remote-all]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var cmd = btn.getAttribute('data-remote-all') || 'reload';
                    var lbl = (btn.textContent || '').trim();
                    if (cmd === 'update_apk' && !global.confirm('إرسال أمر تحديث التطبيق (APK) لجميع الشاشات المتصلة الآن؟')) return;
                    sendRemoteCmd('all', cmd, lbl);
                });
            });
            if ($('iptvAddBtn')) {
                $('iptvAddBtn').addEventListener('click', function () {
                    var nameEl = $('iptvAddName');
                    var grpEl = $('iptvAddGroup');
                    var urlEl = $('iptvAddUrl');
                    var nm = (nameEl && nameEl.value || '').trim();
                    var grp = (grpEl && grpEl.value || 'القنوات السعودية').trim();
                    var u = (urlEl && urlEl.value || '').trim();
                    if (!nm || !/^https?:\/\/|^\//i.test(u)) {
                        showStaffToast('أدخل اسم القناة ورابط بث صحيح يبدأ بـ http أو https', true);
                        return;
                    }
                    state.iptvChannels.push({
                        id: 'custom_' + Date.now().toString(36),
                        name: nm,
                        group: grp,
                        url: u,
                        enabled: true
                    });
                    if (nameEl) nameEl.value = '';
                    if (urlEl) urlEl.value = '';
                    persistIptvChannels('تمت إضافة القناة إلى قائمة الفندق');
                });
            }
            if ($('iptvResetDefaultBtn')) {
                $('iptvResetDefaultBtn').addEventListener('click', async function () {
                    if (!global.confirm('استعادة الباقة السعودية والعربية الافتراضية (24 قناة)؟')) return;
                    if (!db.staffResetChannels) return;
                    var res = await db.staffResetChannels(state.pin);
                    if (res && res.ok && Array.isArray(res.channels)) {
                        state.iptvChannels = res.channels;
                        renderIptvChannels();
                        showStaffToast('تمت استعادة القنوات السعودية والعربية الافتراضية', false);
                    }
                });
            }
            if ($('saveSettingsBtn')) $('saveSettingsBtn').addEventListener('click', saveHotelSettings);
            if ($('changePinBtn')) $('changePinBtn').addEventListener('click', changeStaffPin);
            if ($('apkUploadBtn') && $('apkFileInput')) {
                $('apkUploadBtn').addEventListener('click', function () {
                    $('apkFileInput').click();
                });
                $('apkFileInput').addEventListener('change', function () {
                    var f = $('apkFileInput').files && $('apkFileInput').files[0];
                    $('apkFileInput').value = '';
                    if (f) uploadApkFile(f);
                });
            }
            if ($('staffLogoutBtn')) $('staffLogoutBtn').addEventListener('click', logout);

            try {
                var savedPin = global.sessionStorage.getItem('STAFF_PIN');
                if (savedPin) await tryLogin(savedPin);
            } catch (e) {}
        }
    };
})(window);

