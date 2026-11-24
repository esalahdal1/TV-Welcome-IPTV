(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};

    var RTC_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    function createSessionId() {
        return Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
    }

    function makeChannelName(room, pin) {
        return 'tvip-cast-' + String(room || '101').trim() + '-' + String(pin || '0000').trim();
    }

    /* --- TV Receiver Controller --- */
    var receiver = {
        channel: null,
        pc: null,
        channelKey: null,
        activeSenderId: null,
        pendingIce: [],
        callbacks: {}
    };

    function cleanupReceiverPeer() {
        receiver.activeSenderId = null;
        receiver.pendingIce = [];
        if (receiver.pc) {
            try { receiver.pc.ontrack = null; } catch (e) {}
            try { receiver.pc.onicecandidate = null; } catch (e2) {}
            try { receiver.pc.oniceconnectionstatechange = null; } catch (e3) {}
            try { receiver.pc.close(); } catch (e4) {}
            receiver.pc = null;
        }
    }

    function stopReceiver() {
        cleanupReceiverPeer();
        var client = TVApp.db.getRawClient();
        if (receiver.channel) {
            try {
                if (client && typeof client.removeChannel === 'function') {
                    client.removeChannel(receiver.channel);
                } else if (typeof receiver.channel.unsubscribe === 'function') {
                    receiver.channel.unsubscribe();
                }
            } catch (e) {}
            receiver.channel = null;
        }
        receiver.channelKey = null;
    }

    async function handleReceiverOffer(payload) {
        if (!payload || !payload.sdp || !payload.senderId) return;
        cleanupReceiverPeer();

        receiver.activeSenderId = payload.senderId;
        var pc = new global.RTCPeerConnection(RTC_CONFIG);
        receiver.pc = pc;

        pc.ontrack = function (event) {
            var stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
            if (!stream && event.track) {
                stream = new global.MediaStream([event.track]);
            }
            if (stream && typeof receiver.callbacks.onStream === 'function') {
                receiver.callbacks.onStream(stream);
            }
        };

        pc.onicecandidate = function (event) {
            if (!event.candidate || !receiver.channel) return;
            receiver.channel.send({
                type: 'broadcast',
                event: 'rtc',
                payload: {
                    kind: 'ice',
                    from: 'tv',
                    senderId: receiver.activeSenderId,
                    candidate: event.candidate
                }
            });
        };

        pc.oniceconnectionstatechange = function () {
            var st = pc.iceConnectionState;
            if (st === 'disconnected' || st === 'failed' || st === 'closed') {
                cleanupReceiverPeer();
                if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
            }
        };

        try {
            await pc.setRemoteDescription(new global.RTCSessionDescription(payload.sdp));
            while (receiver.pendingIce.length > 0) {
                var cand = receiver.pendingIce.shift();
                try { await pc.addIceCandidate(new global.RTCIceCandidate(cand)); } catch (e) {}
            }
            var answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (receiver.channel) {
                await receiver.channel.send({
                    type: 'broadcast',
                    event: 'rtc',
                    payload: {
                        kind: 'answer',
                        from: 'tv',
                        senderId: receiver.activeSenderId,
                        sdp: answer
                    }
                });
            }
        } catch (err) {
            cleanupReceiverPeer();
            if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
        }
    }

    function startReceiver(room, pin, callbacks) {
        receiver.callbacks = callbacks || {};
        if (typeof global.RTCPeerConnection !== 'function') return;
        var client = TVApp.db.getRawClient();
        if (!client) return;

        var key = makeChannelName(room, pin);
        if (receiver.channelKey === key && receiver.channel) return;

        stopReceiver();
        receiver.channelKey = key;

        var ch = client.channel(key, {
            config: { broadcast: { self: false } }
        });

        ch.on('broadcast', { event: 'rtc' }, function (msg) {
            var p = msg && msg.payload;
            if (!p || p.from === 'tv') return;

            if (p.kind === 'offer') {
                handleReceiverOffer(p);
                return;
            }
            if (p.kind === 'ice' && p.senderId === receiver.activeSenderId && p.candidate && receiver.pc) {
                if (receiver.pc.remoteDescription) {
                    receiver.pc.addIceCandidate(new global.RTCIceCandidate(p.candidate)).catch(function () {});
                } else {
                    receiver.pendingIce.push(p.candidate);
                }
                return;
            }
            if (p.kind === 'stop' && (!p.senderId || p.senderId === receiver.activeSenderId)) {
                cleanupReceiverPeer();
                if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
            }
        });

        ch.subscribe(function (status) {
            if (typeof receiver.callbacks.onChannelStatus === 'function') {
                receiver.callbacks.onChannelStatus(status);
            }
        });
        receiver.channel = ch;
    }

    function stopBroadcastFromTv() {
        var senderId = receiver.activeSenderId;
        if (receiver.channel && senderId) {
            try {
                receiver.channel.send({
                    type: 'broadcast',
                    event: 'rtc',
                    payload: { kind: 'stop', from: 'tv', senderId: senderId }
                });
            } catch (e) {}
        }
        cleanupReceiverPeer();
        if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
    }

    /* --- Laptop / Mobile Sender Controller --- */
    var sender = {
        channel: null,
        pc: null,
        stream: null,
        senderId: null,
        pendingIce: [],
        callbacks: {}
    };

    function isScreenCaptureSupported() {
        return !!(
            global.RTCPeerConnection &&
            global.navigator &&
            global.navigator.mediaDevices &&
            typeof global.navigator.mediaDevices.getDisplayMedia === 'function'
        );
    }

    function stopSender(notifyRemote) {
        if (notifyRemote && sender.channel && sender.senderId) {
            try {
                sender.channel.send({
                    type: 'broadcast',
                    event: 'rtc',
                    payload: { kind: 'stop', from: 'laptop', senderId: sender.senderId }
                });
            } catch (e) {}
        }

        if (sender.stream) {
            sender.stream.getTracks().forEach(function (t) {
                try { t.onended = null; t.stop(); } catch (e2) {}
            });
            sender.stream = null;
        }
        if (sender.pc) {
            try { sender.pc.onicecandidate = null; } catch (e3) {}
            try { sender.pc.oniceconnectionstatechange = null; } catch (e4) {}
            try { sender.pc.close(); } catch (e5) {}
            sender.pc = null;
        }
        var client = TVApp.db.getRawClient();
        if (sender.channel) {
            try {
                if (client && typeof client.removeChannel === 'function') {
                    client.removeChannel(sender.channel);
                } else if (typeof sender.channel.unsubscribe === 'function') {
                    sender.channel.unsubscribe();
                }
            } catch (e6) {}
            sender.channel = null;
        }
        sender.senderId = null;
        sender.pendingIce = [];
        if (typeof sender.callbacks.onState === 'function') sender.callbacks.onState('stopped');
    }

    async function startSender(room, pin, callbacks) {
        sender.callbacks = callbacks || {};
        if (!isScreenCaptureSupported()) {
            if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('UNSUPPORTED');
            return;
        }
        var client = TVApp.db.getRawClient();
        if (!client) {
            if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('NO_SIGNALING');
            return;
        }

        stopSender(false);

        var stream;
        try {
            stream = await global.navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30, max: 60 } },
                audio: true
            });
        } catch (err) {
            if (typeof sender.callbacks.onError === 'function') {
                sender.callbacks.onError(err && err.name === 'NotAllowedError' ? 'CANCELLED' : 'CAPTURE_FAILED');
            }
            return;
        }

        sender.stream = stream;
        sender.senderId = createSessionId();
        sender.pendingIce = [];
        if (typeof sender.callbacks.onState === 'function') sender.callbacks.onState('connecting');

        var pc = new global.RTCPeerConnection(RTC_CONFIG);
        sender.pc = pc;

        stream.getTracks().forEach(function (track) {
            pc.addTrack(track, stream);
            track.onended = function () {
                stopSender(true);
            };
        });

        var ch = client.channel(makeChannelName(room, pin), {
            config: { broadcast: { self: false } }
        });
        sender.channel = ch;

        pc.onicecandidate = function (event) {
            if (!event.candidate || !sender.channel) return;
            sender.channel.send({
                type: 'broadcast',
                event: 'rtc',
                payload: {
                    kind: 'ice',
                    from: 'laptop',
                    senderId: sender.senderId,
                    candidate: event.candidate
                }
            });
        };

        pc.oniceconnectionstatechange = function () {
            var st = pc.iceConnectionState;
            if (st === 'connected' || st === 'completed') {
                if (typeof sender.callbacks.onState === 'function') sender.callbacks.onState('connected');
            } else if (st === 'failed' || st === 'closed' || st === 'disconnected') {
                stopSender(false);
            }
        };

        ch.on('broadcast', { event: 'rtc' }, async function (msg) {
            var p = msg && msg.payload;
            if (!p || p.from !== 'tv' || p.senderId !== sender.senderId) return;

            if (p.kind === 'answer' && p.sdp && sender.pc) {
                try {
                    await sender.pc.setRemoteDescription(new global.RTCSessionDescription(p.sdp));
                    while (sender.pendingIce.length > 0) {
                        var cand = sender.pendingIce.shift();
                        try { await sender.pc.addIceCandidate(new global.RTCIceCandidate(cand)); } catch (e) {}
                    }
                } catch (e2) {}
                return;
            }
            if (p.kind === 'ice' && p.candidate && sender.pc) {
                if (sender.pc.remoteDescription) {
                    sender.pc.addIceCandidate(new global.RTCIceCandidate(p.candidate)).catch(function () {});
                } else {
                    sender.pendingIce.push(p.candidate);
                }
                return;
            }
            if (p.kind === 'stop') {
                stopSender(false);
            }
        });

        ch.subscribe(async function (status) {
            if (status === 'SUBSCRIBED') {
                try {
                    var offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    await ch.send({
                        type: 'broadcast',
                        event: 'rtc',
                        payload: {
                            kind: 'offer',
                            from: 'laptop',
                            senderId: sender.senderId,
                            sdp: offer
                        }
                    });
                } catch (err2) {
                    stopSender(false);
                    if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('SIGNAL_FAILED');
                }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                stopSender(false);
                if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('SIGNAL_FAILED');
            }
        });
    }

    TVApp.webrtcCast = {
        startReceiver: startReceiver,
        stopReceiver: stopReceiver,
        stopBroadcastFromTv: stopBroadcastFromTv,
        isScreenCaptureSupported: isScreenCaptureSupported,
        startSender: startSender,
        stopSender: function () { stopSender(true); }
    };
})(window);

