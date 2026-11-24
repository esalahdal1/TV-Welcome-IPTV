(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var utils = TVApp.utils;

    var client = null;
    if (global.supabase && typeof global.supabase.createClient === 'function' && cfg.SUPABASE_KEY) {
        client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
    }

    var params = new URLSearchParams(global.location.search || '');
    var forceCloud = params.get('cloud') === '1' || !!params.get('sbUrl');
    var forceLocal = params.get('local') === '1';

    var backendState = {
        checkedLocal: false,
        useLocal: false,
        probePromise: null
    };

    function withTimeout(promise, ms) {
        var timer = null;
        return Promise.race([
            promise,
            new Promise(function (resolve) {
                timer = global.setTimeout(function () {
                    resolve({ data: null, error: { message: 'Request timeout' }, _timeout: true });
                }, ms || 3500);
            })
        ]).then(function (res) {
            if (timer) global.clearTimeout(timer);
            return res;
        }).catch(function (err) {
            if (timer) global.clearTimeout(timer);
            return { data: null, error: { message: (err && err.message) || 'Network error' } };
        });
    }

    async function fetchJson(url, options, timeoutMs) {
        var controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
        var timer = null;
        if (controller) {
            timer = global.setTimeout(function () { controller.abort(); }, timeoutMs || 3500);
        }
        try {
            var opts = Object.assign({ cache: 'no-store' }, options || {});
            if (controller) opts.signal = controller.signal;
            var resp = await global.fetch(url, opts);
            var text = await resp.text();
            var data = text ? JSON.parse(text) : null;
            return { ok: resp.ok, status: resp.status, data: data };
        } catch (err) {
            return { ok: false, status: 0, error: err };
        } finally {
            if (timer) global.clearTimeout(timer);
        }
    }

    async function detectLocalBackend() {
        if (backendState.checkedLocal) return backendState.useLocal;
        if (backendState.probePromise) return backendState.probePromise;

        if (global.location.protocol === 'file:' || (forceCloud && !forceLocal)) {
            backendState.checkedLocal = true;
            backendState.useLocal = false;
            return false;
        }

        backendState.probePromise = (async function () {
            var res = await fetchJson('/api/health', {}, 1200);
            var alive = !!(res.ok && res.data && res.data.ok);
            backendState.checkedLocal = true;
            backendState.useLocal = forceLocal || alive;
            return backendState.useLocal;
        })();
        return backendState.probePromise;
    }

    function postApi(path, body, timeoutMs) {
        return fetchJson(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        }, timeoutMs || 4000);
    }

    function isMissingRpcError(err) {
        if (!err) return false;
        var code = String(err.code || '');
        var status = Number(err.status || err.statusCode || 0);
        var msg = String(err.message || '').toLowerCase();
        return status === 404 ||
            code === 'PGRST202' ||
            code === '42883' ||
            msg.indexOf('could not find the function') !== -1 ||
            msg.indexOf('does not exist') !== -1 ||
            msg.indexOf('schema cache') !== -1;
    }

    // Start local server health detection early so interactive clicks respond in milliseconds
    detectLocalBackend();

    TVApp.db = {
        isReady: function () {
            return !!(backendState.useLocal || client);
        },

        isLocalMode: function () {
            return !!backendState.useLocal;
        },

        ensureBackendReady: detectLocalBackend,

        getRawClient: function () {
            return client;
        },

        syncTvPin: async function (room, pin) {
            var safeRoom = utils.normalizeDigits((room || '').trim());
            var safePin = utils.normalizeDigits((pin || '').trim());
            if (!safeRoom || !/^\d{4}$/.test(safePin)) return null;
            if (!(await detectLocalBackend())) return null;
            var res = await postApi('/api/guest/sync-pin', { room: safeRoom, pin: safePin }, 2500);
            return res.ok ? res.data : null;
        },

        fetchGuestProfile: async function (room) {
            if (!room) return { _offline: true };
            if (await detectLocalBackend()) {
                var loc = await fetchJson('/api/guest?room=' + encodeURIComponent(room), {}, 2500);
                if (!loc.ok) return { _offline: true };
                return loc.data || null;
            }

            if (!client) return { _offline: true };
            var hadError = false;
            try {
                var res = await withTimeout(
                    client.from('guests').select('full_name, cast_pin, preferred_lang').eq('room_number', room).maybeSingle(),
                    3500
                );
                if (!res.error) return res.data || null;
                hadError = true;
            } catch (e) { hadError = true; }

            try {
                var fallback = await withTimeout(
                    client.from('guests').select('full_name').eq('room_number', room).maybeSingle(),
                    3000
                );
                if (!fallback.error) return fallback.data || null;
                hadError = true;
            } catch (e2) { hadError = true; }
            return hadError ? { _offline: true } : null;
        },

        verifyGuestPin: async function (room, pin) {
            var safeRoom = utils.normalizeDigits((room || '').trim());
            var safePin = utils.normalizeDigits((pin || '').trim());
            if (!safeRoom || !/^\d{4}$/.test(safePin)) {
                return { valid: false, full_name: null, preferred_lang: 'ar' };
            }

            if (await detectLocalBackend()) {
                var loc = await postApi('/api/verify-pin', { room: safeRoom, pin: safePin }, 3000);
                if (loc.ok && loc.data) return loc.data;
                return { valid: false, full_name: null, preferred_lang: 'ar' };
            }

            if (client) {
                try {
                    var rpc = await withTimeout(
                        client.rpc('verify_room_pin', { p_room: safeRoom, p_pin: safePin }),
                        3500
                    );
                    if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length > 0) {
                        var row = rpc.data[0];
                        return {
                            valid: !!row.valid,
                            full_name: row.full_name || null,
                            preferred_lang: row.preferred_lang || 'ar'
                        };
                    }
                } catch (e) {}

                try {
                    var direct = await withTimeout(
                        client.from('guests').select('full_name, cast_pin, preferred_lang').eq('room_number', safeRoom).maybeSingle(),
                        3000
                    );
                    if (!direct.error && direct.data && direct.data.cast_pin) {
                        return {
                            valid: String(direct.data.cast_pin).trim() === safePin,
                            full_name: direct.data.full_name || null,
                            preferred_lang: direct.data.preferred_lang || 'ar'
                        };
                    }
                } catch (e2) {}
            }

            return { valid: false, full_name: null, preferred_lang: 'ar', offline: true };
        },

        fetchHotelSettings: async function () {
            if (await detectLocalBackend()) {
                var loc = await fetchJson('/api/settings', {}, 2500);
                return loc.ok ? loc.data : null;
            }
            if (!client) return null;
            try {
                var res = await withTimeout(
                    client.from('hotel_settings').select('wifi_name, wifi_pass, reception_ext, breakfast_hours, checkout_time').eq('id', 1).maybeSingle(),
                    3000
                );
                if (!res.error && res.data) return res.data;
            } catch (e) {}
            return null;
        },

        fetchNewNotifications: async function (room, lastSeenIso) {
            if (await detectLocalBackend()) {
                var url = '/api/notifications?room=' + encodeURIComponent(room || '');
                if (lastSeenIso) url += '&after=' + encodeURIComponent(lastSeenIso);
                var loc = await fetchJson(url, {}, 2500);
                return (loc.ok && Array.isArray(loc.data)) ? loc.data : [];
            }
            if (!client) return [];
            var q = client
                .from('tv_notifications')
                .select('id,room_number,message,created_at')
                .order('created_at', { ascending: true })
                .limit(10);

            q = room
                ? q.or('room_number.is.null,room_number.eq.' + room)
                : q.is('room_number', null);

            if (lastSeenIso) {
                q = q.gt('created_at', lastSeenIso);
            }

            var res = await withTimeout(q, 3500);
            if (res.error || !Array.isArray(res.data)) return [];
            return res.data;
        },

        fetchLatestGlobalNotification: async function () {
            if (await detectLocalBackend()) {
                var loc = await fetchJson('/api/notifications/latest-global', {}, 2500);
                return loc.ok ? loc.data : null;
            }
            if (!client) return null;
            try {
                var res = await withTimeout(
                    client.from('tv_notifications').select('id,message,created_at').is('room_number', null).order('created_at', { ascending: false }).limit(1),
                    3000
                );
                if (!res.error && Array.isArray(res.data) && res.data.length > 0) return res.data[0];
            } catch (e) {}
            return null;
        },

        insertGuestRequest: async function (room, requestTypeLabel) {
            if (await detectLocalBackend()) {
                var loc = await postApi('/api/requests', { room_number: room, request_type: requestTypeLabel }, 4000);
                if (loc.ok && loc.data) return loc.data;
                return { error: { message: (loc.data && loc.data.error && loc.data.error.message) || 'تعذر الاتصال بالسيرفر المحلي' } };
            }
            if (!client) return { error: { message: 'قاعدة البيانات غير متاحة' } };
            return await withTimeout(
                client.from('tv_requests').insert([{ room_number: room, request_type: requestTypeLabel }]),
                4000
            );
        },

        listRoomRequests: async function (room) {
            if (!room) return [];
            if (await detectLocalBackend()) {
                var loc = await fetchJson('/api/requests?room=' + encodeURIComponent(room), {}, 3000);
                return (loc.ok && Array.isArray(loc.data)) ? loc.data : [];
            }
            if (!client) return [];
            try {
                var res = await withTimeout(
                    client.from('tv_requests').select('id,request_type,status,created_at,completed_at').eq('room_number', room).order('created_at', { ascending: false }).limit(8),
                    3500
                );
                if (!res.error && Array.isArray(res.data)) return res.data;
            } catch (e) {}
            return [];
        },

        listRequestsByStatus: async function (status) {
            if (await detectLocalBackend()) {
                var loc = await fetchJson('/api/requests?status=' + encodeURIComponent(status || 'pending'), {}, 3000);
                if (loc.ok && Array.isArray(loc.data)) return { data: loc.data, error: null };
                return { data: null, error: { message: 'تعذر تحميل الطلبات من السيرفر المحلي' } };
            }
            if (!client) return { data: null, error: { message: 'Supabase unavailable' } };
            return await withTimeout(
                client.from('tv_requests').select('id,room_number,request_type,created_at,completed_at,status').eq('status', status).order('created_at', { ascending: false }).limit(80),
                4000
            );
        },

        rtcSend: async function (channel, payload) {
            if (!(await detectLocalBackend())) return false;
            var res = await postApi('/api/rtc/send', { channel: channel, payload: payload }, 2500);
            return !!res.ok;
        },

        rtcPoll: async function (channel, afterSeq) {
            if (!(await detectLocalBackend())) return null;
            var res = await fetchJson('/api/rtc/poll?channel=' + encodeURIComponent(channel) + '&after=' + encodeURIComponent(String(afterSeq || 0)), {}, 2500);
            return res.ok ? res.data : null;
        },

        uploadRoomMedia: async function (room, pin, fileBlob, filename, onProgress) {
            if (!(await detectLocalBackend())) {
                return { ok: false, error: { message: 'بث الصور والفيديو يتطلب السيرفر المحلي على الشبكة.' } };
            }
            var q = new URLSearchParams({
                room: utils.normalizeDigits(room || ''),
                pin: utils.normalizeDigits(pin || ''),
                name: String(filename || 'media')
            });
            return await new Promise(function (resolve) {
                var xhr = new global.XMLHttpRequest();
                xhr.open('POST', '/api/media/upload?' + q.toString(), true);
                xhr.setRequestHeader('Content-Type', (fileBlob && fileBlob.type) ? fileBlob.type : 'application/octet-stream');
                if (xhr.upload && typeof onProgress === 'function') {
                    xhr.upload.onprogress = function (evt) {
                        if (evt.lengthComputable && evt.total > 0) {
                            onProgress(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
                        }
                    };
                }
                xhr.onload = function () {
                    var parsed = null;
                    try { parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {}
                    if (xhr.status >= 200 && xhr.status < 300 && parsed && parsed.ok) {
                        if (typeof onProgress === 'function') onProgress(100);
                        resolve(parsed);
                    } else {
                        resolve({ ok: false, error: (parsed && parsed.error) || { message: 'فشل رفع الملف (' + xhr.status + ')' } });
                    }
                };
                xhr.onerror = function () {
                    resolve({ ok: false, error: { message: 'تعذر الاتصال بالسيرفر أثناء الرفع' } });
                };
                xhr.send(fileBlob);
            });
        },

        getCurrentRoomMedia: async function (room, pin) {
            if (!(await detectLocalBackend())) return { active: false, media: null };
            var q = new URLSearchParams({
                room: utils.normalizeDigits(room || ''),
                pin: utils.normalizeDigits(pin || '')
            });
            var res = await fetchJson('/api/media/current?' + q.toString(), {}, 3000);
            return (res.ok && res.data) ? res.data : { active: false, media: null };
        },

        controlRoomMedia: async function (room, pin, action) {
            if (!(await detectLocalBackend())) return { ok: false };
            var res = await postApi('/api/media/control', {
                room: utils.normalizeDigits(room || ''),
                pin: utils.normalizeDigits(pin || ''),
                action: action
            }, 3000);
            return (res.ok && res.data) ? res.data : { ok: false };
        },

        /* --- Stage 3: Staff Console Methods (Local API or Supabase RPC) --- */
        staffLogin: async function (pin) {
            var clean = utils.normalizeDigits((pin || '').trim());
            if (!clean) return { ok: false, rpcActive: false, localMode: false };

            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/login', { pin: clean }, 3000);
                if (loc.ok && loc.data) return { ok: !!loc.data.ok, rpcActive: true, localMode: true };
                return { ok: false, rpcActive: false, localMode: true };
            }

            if (client) {
                try {
                    var res = await withTimeout(client.rpc('staff_login', { p_pin: clean }), 3500);
                    if (!res.error) {
                        return { ok: !!res.data, rpcActive: true, localMode: false };
                    }
                } catch (e) {}
            }

            return { ok: clean === cfg.ADMIN_PIN, rpcActive: false, localMode: false };
        },

        staffListGuests: async function (pin) {
            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/guests', { pin: pin }, 3000);
                if (loc.ok && loc.data) return { data: loc.data.data || [], error: null, rpcActive: true, localMode: true };
                return { data: null, error: (loc.data && loc.data.error) || { message: 'تعذر تحميل الغرف' }, rpcActive: false, localMode: true };
            }

            if (!client) return { data: null, error: { message: 'Supabase unavailable' }, rpcActive: false };

            try {
                var rpc = await withTimeout(client.rpc('staff_list_guests', { p_pin: pin }), 3500);
                if (!rpc.error) return { data: rpc.data || [], error: null, rpcActive: true };
                if (!isMissingRpcError(rpc.error)) return { data: null, error: rpc.error, rpcActive: true };
            } catch (e) {}

            try {
                var ext = await withTimeout(
                    client.from('guests').select('room_number, full_name, cast_pin, preferred_lang').order('room_number', { ascending: true }),
                    3500
                );
                if (!ext.error) return { data: ext.data || [], error: null, rpcActive: false };
            } catch (e2) {}

            var basic = await withTimeout(
                client.from('guests').select('room_number, full_name').order('room_number', { ascending: true }),
                3500
            );
            return { data: basic.data || [], error: basic.error, rpcActive: false };
        },

        staffCheckinGuest: async function (pin, room, fullName, lang) {
            var cleanRoom = utils.normalizeDigits((room || '').trim());
            var cleanName = String(fullName || '').trim();
            var cleanLang = lang === 'en' ? 'en' : 'ar';

            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/checkin', { pin: pin, room: cleanRoom, full_name: cleanName, lang: cleanLang }, 3500);
                if (loc.ok && loc.data) return loc.data;
                return { data: null, error: (loc.data && loc.data.error) || { message: 'تعذر حفظ بيانات الغرفة' } };
            }

            if (!client) return { data: null, error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await withTimeout(client.rpc('staff_checkin_guest', {
                    p_pin: pin,
                    p_room: cleanRoom,
                    p_full_name: cleanName,
                    p_lang: cleanLang
                }), 3500);
                if (!rpc.error) {
                    var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
                    return { data: row || null, error: null };
                }
                if (!isMissingRpcError(rpc.error)) return { data: null, error: rpc.error };
            } catch (e) {}

            var newPin = String(Math.floor(1000 + Math.random() * 9000));
            try { global.localStorage.setItem('ROOM_CAST_PIN_' + cleanRoom, newPin); } catch (e2) {}

            var up = await withTimeout(
                client.from('guests').upsert({ room_number: cleanRoom, full_name: cleanName, cast_pin: newPin, preferred_lang: cleanLang }, { onConflict: 'room_number' }).select(),
                3500
            );
            if (!up.error) return { data: { room_number: cleanRoom, full_name: cleanName, cast_pin: newPin, preferred_lang: cleanLang }, error: null };

            var upBasic = await withTimeout(
                client.from('guests').upsert({ room_number: cleanRoom, full_name: cleanName }, { onConflict: 'room_number' }).select(),
                3500
            );
            return { data: { room_number: cleanRoom, full_name: cleanName, cast_pin: newPin, preferred_lang: 'ar' }, error: upBasic.error };
        },

        staffCheckoutGuest: async function (pin, room) {
            var cleanRoom = utils.normalizeDigits((room || '').trim());

            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/checkout', { pin: pin, room: cleanRoom }, 3500);
                if (loc.ok && loc.data) return loc.data;
                return { data: null, error: (loc.data && loc.data.error) || { message: 'تعذر تسجيل المغادرة' } };
            }

            if (!client) return { data: null, error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await withTimeout(client.rpc('staff_checkout_guest', { p_pin: pin, p_room: cleanRoom }), 3500);
                if (!rpc.error) {
                    var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
                    return { data: row || null, error: null };
                }
                if (!isMissingRpcError(rpc.error)) return { data: null, error: rpc.error };
            } catch (e) {}

            try {
                var rpc2 = await withTimeout(client.rpc('checkout_room_and_rotate_pin', { p_room: cleanRoom }), 3500);
                if (!rpc2.error) {
                    var row2 = Array.isArray(rpc2.data) ? rpc2.data[0] : rpc2.data;
                    return { data: row2 || null, error: null };
                }
            } catch (e2) {}

            var newPin = String(Math.floor(1000 + Math.random() * 9000));
            try { global.localStorage.setItem('ROOM_CAST_PIN_' + cleanRoom, newPin); } catch (e3) {}
            var up = await withTimeout(
                client.from('guests').update({ full_name: '' }).eq('room_number', cleanRoom),
                3500
            );
            return { data: { room_number: cleanRoom, cast_pin: newPin }, error: up.error };
        },

        staffSendNotification: async function (pin, targetRoom, message) {
            var cleanRoom = targetRoom ? utils.normalizeDigits(targetRoom.trim()) : '';

            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/notify', { pin: pin, room: cleanRoom || null, message: message }, 3500);
                return loc.ok ? { error: null } : { error: (loc.data && loc.data.error) || { message: 'فشل الإرسال' } };
            }

            if (!client) return { error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await withTimeout(client.rpc('staff_send_notification', {
                    p_pin: pin,
                    p_room: cleanRoom || null,
                    p_message: message
                }), 3500);
                if (!rpc.error) return { error: null };
                if (!isMissingRpcError(rpc.error)) return { error: rpc.error };
            } catch (e) {}

            var payload = { message: message };
            if (cleanRoom) payload.room_number = cleanRoom;
            return await withTimeout(client.from('tv_notifications').insert([payload]), 3500);
        },

        staffListNotifications: async function (pin) {
            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/notifications', { pin: pin }, 3000);
                if (loc.ok && loc.data) return { data: loc.data.data || [], error: null };
                return { data: [], error: (loc.data && loc.data.error) || { message: 'فشل التحميل' } };
            }

            if (!client) return { data: [], error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await withTimeout(client.rpc('staff_list_notifications', { p_pin: pin }), 3500);
                if (!rpc.error) return { data: rpc.data || [], error: null };
                if (!isMissingRpcError(rpc.error)) return { data: [], error: rpc.error };
            } catch (e) {}

            return await withTimeout(
                client.from('tv_notifications').select('id,room_number,message,created_at').order('created_at', { ascending: false }).limit(20),
                3500
            );
        },

        staffCompleteRequest: async function (pin, requestId) {
            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/complete-request', { pin: pin, request_id: requestId }, 3000);
                return loc.ok ? { error: null } : { error: (loc.data && loc.data.error) || { message: 'فشل التحديث' } };
            }

            if (!client) return { error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await withTimeout(client.rpc('staff_complete_request', { p_pin: pin, p_request_id: requestId }), 3500);
                if (!rpc.error) return { error: null };
                if (!isMissingRpcError(rpc.error)) return { error: rpc.error };
            } catch (e) {}

            return await withTimeout(
                client.from('tv_requests').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', requestId),
                3500
            );
        },

        staffUpdateHotelSettings: async function (pin, settings) {
            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/settings', { pin: pin, settings: settings }, 3500);
                return loc.ok ? { error: null } : { error: (loc.data && loc.data.error) || { message: 'فشل الحفظ' } };
            }

            if (!client) return { error: { message: 'Supabase unavailable' } };
            try {
                var rpc = await withTimeout(client.rpc('staff_update_hotel_settings', {
                    p_pin: pin,
                    p_wifi_name: settings.wifi_name,
                    p_wifi_pass: settings.wifi_pass,
                    p_reception_ext: settings.reception_ext,
                    p_breakfast_hours: settings.breakfast_hours,
                    p_checkout_time: settings.checkout_time
                }), 3500);
                if (!rpc.error) return { error: null };
                if (!isMissingRpcError(rpc.error)) return { error: rpc.error };
            } catch (e) {}

            return { error: { message: 'يرجى تشغيل ملف SQL المرحلة 2 و3 في Supabase لحفظ إعدادات الفندق مركزيًا.' } };
        },

        staffChangePin: async function (oldPin, newPin) {
            if (await detectLocalBackend()) {
                var loc = await postApi('/api/staff/change-pin', { old_pin: oldPin, new_pin: newPin }, 3500);
                return loc.ok ? { error: null } : { error: (loc.data && loc.data.error) || { message: 'تعذر التغيير' } };
            }

            if (!client) return { error: { message: 'Supabase unavailable' } };
            try {
                var rpc = await withTimeout(client.rpc('staff_change_pin', { p_old_pin: oldPin, p_new_pin: newPin }), 3500);
                if (!rpc.error) return { error: null };
                return { error: rpc.error };
            } catch (e) {
                return { error: { message: 'تعذر تغيير الرمز. تأكد من تشغيل ملف SQL المرحلة 3.' } };
            }
        }
    };
})(window);
