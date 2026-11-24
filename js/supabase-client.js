(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var utils = TVApp.utils;

    var client = null;
    if (global.supabase && typeof global.supabase.createClient === 'function' && cfg.SUPABASE_KEY) {
        client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
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

    TVApp.db = {
        isReady: function () {
            return !!client;
        },

        getRawClient: function () {
            return client;
        },

        fetchGuestProfile: async function (room) {
            if (!client || !room) return { _offline: true };
            var hadError = false;
            try {
                var res = await client
                    .from('guests')
                    .select('full_name, cast_pin, preferred_lang')
                    .eq('room_number', room)
                    .maybeSingle();

                if (!res.error) return res.data || null;
                hadError = true;
            } catch (e) { hadError = true; }

            try {
                var fallback = await client
                    .from('guests')
                    .select('full_name')
                    .eq('room_number', room)
                    .maybeSingle();
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

            if (client) {
                try {
                    var rpc = await client.rpc('verify_room_pin', { p_room: safeRoom, p_pin: safePin });
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
                    var direct = await client
                        .from('guests')
                        .select('full_name, cast_pin, preferred_lang')
                        .eq('room_number', safeRoom)
                        .maybeSingle();
                    if (!direct.error && direct.data && direct.data.cast_pin) {
                        return {
                            valid: String(direct.data.cast_pin).trim() === safePin,
                            full_name: direct.data.full_name || null,
                            preferred_lang: direct.data.preferred_lang || 'ar'
                        };
                    }
                } catch (e2) {}
            }

            var localPin = utils.getOrCreateFallbackPin(safeRoom);
            var guestObj = await this.fetchGuestProfile(safeRoom);
            return {
                valid: localPin === safePin,
                full_name: guestObj && guestObj.full_name ? guestObj.full_name : null,
                preferred_lang: 'ar'
            };
        },

        fetchHotelSettings: async function () {
            if (!client) return null;
            try {
                var res = await client
                    .from('hotel_settings')
                    .select('wifi_name, wifi_pass, reception_ext, breakfast_hours, checkout_time')
                    .eq('id', 1)
                    .maybeSingle();
                if (!res.error && res.data) return res.data;
            } catch (e) {}
            return null;
        },

        fetchNewNotifications: async function (room, lastSeenIso) {
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

            var res = await q;
            if (res.error || !Array.isArray(res.data)) return [];
            return res.data;
        },

        fetchLatestGlobalNotification: async function () {
            if (!client) return null;
            try {
                var res = await client
                    .from('tv_notifications')
                    .select('id,message,created_at')
                    .is('room_number', null)
                    .order('created_at', { ascending: false })
                    .limit(1);
                if (!res.error && Array.isArray(res.data) && res.data.length > 0) return res.data[0];
            } catch (e) {}
            return null;
        },

        insertGuestRequest: async function (room, requestTypeLabel) {
            if (!client) return { error: { message: 'Supabase unavailable' } };
            return await client
                .from('tv_requests')
                .insert([{ room_number: room, request_type: requestTypeLabel }]);
        },

        listRoomRequests: async function (room) {
            if (!client || !room) return [];
            try {
                var res = await client
                    .from('tv_requests')
                    .select('id,request_type,status,created_at,completed_at')
                    .eq('room_number', room)
                    .order('created_at', { ascending: false })
                    .limit(8);
                if (!res.error && Array.isArray(res.data)) return res.data;
            } catch (e) {}
            return [];
        },

        listRequestsByStatus: async function (status) {
            if (!client) return { data: null, error: { message: 'Supabase unavailable' } };
            return await client
                .from('tv_requests')
                .select('id,room_number,request_type,created_at,completed_at,status')
                .eq('status', status)
                .order('created_at', { ascending: false })
                .limit(80);
        },

        /* --- Stage 3: Staff Console Methods (RPC first + safe fallback) --- */
        staffLogin: async function (pin) {
            var clean = utils.normalizeDigits((pin || '').trim());
            if (!clean) return { ok: false, rpcActive: false };

            if (client) {
                try {
                    var res = await client.rpc('staff_login', { p_pin: clean });
                    if (!res.error) {
                        return { ok: !!res.data, rpcActive: true };
                    }
                    // If the RPC failed to execute (e.g. not deployed yet, 404, or network error),
                    // fall back cleanly to the local default PIN check below.
                } catch (e) {}
            }

            return { ok: clean === cfg.ADMIN_PIN, rpcActive: false };
        },

        staffListGuests: async function (pin) {
            if (!client) return { data: null, error: { message: 'Supabase unavailable' }, rpcActive: false };

            try {
                var rpc = await client.rpc('staff_list_guests', { p_pin: pin });
                if (!rpc.error) return { data: rpc.data || [], error: null, rpcActive: true };
                if (!isMissingRpcError(rpc.error)) return { data: null, error: rpc.error, rpcActive: true };
            } catch (e) {}

            // Fallback when Stage 3 SQL hasn't been deployed yet
            try {
                var ext = await client
                    .from('guests')
                    .select('room_number, full_name, cast_pin, preferred_lang')
                    .order('room_number', { ascending: true });
                if (!ext.error) return { data: ext.data || [], error: null, rpcActive: false };
            } catch (e2) {}

            var basic = await client
                .from('guests')
                .select('room_number, full_name')
                .order('room_number', { ascending: true });
            return { data: basic.data || [], error: basic.error, rpcActive: false };
        },

        staffCheckinGuest: async function (pin, room, fullName, lang) {
            if (!client) return { data: null, error: { message: 'Supabase unavailable' } };
            var cleanRoom = utils.normalizeDigits((room || '').trim());
            var cleanName = String(fullName || '').trim();
            var cleanLang = lang === 'en' ? 'en' : 'ar';

            try {
                var rpc = await client.rpc('staff_checkin_guest', {
                    p_pin: pin,
                    p_room: cleanRoom,
                    p_full_name: cleanName,
                    p_lang: cleanLang
                });
                if (!rpc.error) {
                    var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
                    return { data: row || null, error: null };
                }
                if (!isMissingRpcError(rpc.error)) return { data: null, error: rpc.error };
            } catch (e) {}

            // Legacy fallback if Stage 3 SQL isn't run yet
            var newPin = String(Math.floor(1000 + Math.random() * 9000));
            try { global.localStorage.setItem('ROOM_CAST_PIN_' + cleanRoom, newPin); } catch (e2) {}

            var up = await client
                .from('guests')
                .upsert({ room_number: cleanRoom, full_name: cleanName, cast_pin: newPin, preferred_lang: cleanLang }, { onConflict: 'room_number' })
                .select();
            if (!up.error) return { data: { room_number: cleanRoom, full_name: cleanName, cast_pin: newPin, preferred_lang: cleanLang }, error: null };

            var upBasic = await client
                .from('guests')
                .upsert({ room_number: cleanRoom, full_name: cleanName }, { onConflict: 'room_number' })
                .select();
            return { data: { room_number: cleanRoom, full_name: cleanName, cast_pin: newPin, preferred_lang: 'ar' }, error: upBasic.error };
        },

        staffCheckoutGuest: async function (pin, room) {
            if (!client) return { data: null, error: { message: 'Supabase unavailable' } };
            var cleanRoom = utils.normalizeDigits((room || '').trim());

            try {
                var rpc = await client.rpc('staff_checkout_guest', { p_pin: pin, p_room: cleanRoom });
                if (!rpc.error) {
                    var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
                    return { data: row || null, error: null };
                }
                if (!isMissingRpcError(rpc.error)) return { data: null, error: rpc.error };
            } catch (e) {}

            try {
                var rpc2 = await client.rpc('checkout_room_and_rotate_pin', { p_room: cleanRoom });
                if (!rpc2.error) {
                    var row2 = Array.isArray(rpc2.data) ? rpc2.data[0] : rpc2.data;
                    return { data: row2 || null, error: null };
                }
            } catch (e2) {}

            var newPin = String(Math.floor(1000 + Math.random() * 9000));
            try { global.localStorage.setItem('ROOM_CAST_PIN_' + cleanRoom, newPin); } catch (e3) {}
            var up = await client
                .from('guests')
                .update({ full_name: '' })
                .eq('room_number', cleanRoom);
            return { data: { room_number: cleanRoom, cast_pin: newPin }, error: up.error };
        },

        staffSendNotification: async function (pin, targetRoom, message) {
            if (!client) return { error: { message: 'Supabase unavailable' } };
            var cleanRoom = targetRoom ? utils.normalizeDigits(targetRoom.trim()) : '';

            try {
                var rpc = await client.rpc('staff_send_notification', {
                    p_pin: pin,
                    p_room: cleanRoom || null,
                    p_message: message
                });
                if (!rpc.error) return { error: null };
                if (!isMissingRpcError(rpc.error)) return { error: rpc.error };
            } catch (e) {}

            var payload = { message: message };
            if (cleanRoom) payload.room_number = cleanRoom;
            return await client.from('tv_notifications').insert([payload]);
        },

        staffListNotifications: async function (pin) {
            if (!client) return { data: [], error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await client.rpc('staff_list_notifications', { p_pin: pin });
                if (!rpc.error) return { data: rpc.data || [], error: null };
                if (!isMissingRpcError(rpc.error)) return { data: [], error: rpc.error };
            } catch (e) {}

            return await client
                .from('tv_notifications')
                .select('id,room_number,message,created_at')
                .order('created_at', { ascending: false })
                .limit(20);
        },

        staffCompleteRequest: async function (pin, requestId) {
            if (!client) return { error: { message: 'Supabase unavailable' } };

            try {
                var rpc = await client.rpc('staff_complete_request', { p_pin: pin, p_request_id: requestId });
                if (!rpc.error) return { error: null };
                if (!isMissingRpcError(rpc.error)) return { error: rpc.error };
            } catch (e) {}

            return await client
                .from('tv_requests')
                .update({ status: 'done', completed_at: new Date().toISOString() })
                .eq('id', requestId);
        },

        staffUpdateHotelSettings: async function (pin, settings) {
            if (!client) return { error: { message: 'Supabase unavailable' } };
            try {
                var rpc = await client.rpc('staff_update_hotel_settings', {
                    p_pin: pin,
                    p_wifi_name: settings.wifi_name,
                    p_wifi_pass: settings.wifi_pass,
                    p_reception_ext: settings.reception_ext,
                    p_breakfast_hours: settings.breakfast_hours,
                    p_checkout_time: settings.checkout_time
                });
                if (!rpc.error) return { error: null };
                if (!isMissingRpcError(rpc.error)) return { error: rpc.error };
            } catch (e) {}

            return { error: { message: 'يرجى تشغيل ملف SQL المرحلة 2 و3 في Supabase لحفظ إعدادات الفندق مركزيًا.' } };
        },

        staffChangePin: async function (oldPin, newPin) {
            if (!client) return { error: { message: 'Supabase unavailable' } };
            try {
                var rpc = await client.rpc('staff_change_pin', { p_old_pin: oldPin, p_new_pin: newPin });
                if (!rpc.error) return { error: null };
                return { error: rpc.error };
            } catch (e) {
                return { error: { message: 'تعذر تغيير الرمز. تأكد من تشغيل ملف SQL المرحلة 3.' } };
            }
        }
    };
})(window);
