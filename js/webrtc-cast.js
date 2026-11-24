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

    async function createSignalingBridge(channelKey, onPayload, onReady) {
        var isLocal = TVApp.db && TVApp.db.ensureBackendReady ? await TVApp.db.ensureBackendReady() : false;
        if (isLocal && TVApp.db.rtcSend && TVApp.db.rtcPoll) {
            var active = true;
            var lastSeq = 0;
            var pollHandle = null;

            var initRes = await TVApp.db.rtcPoll(channelKey, 0);
            if (initRes && typeof initRes.lastSeq === 'number') {
                lastSeq = initRes.lastSeq;
            }

            pollHandle = global.setInterval(async function () {
                if (!active) return;
                var res = await TVApp.db.rtcPoll(channelKey, lastSeq);
                if (!active || !res || !Array.isArray(res.messages)) return;
                if (typeof res.lastSeq === 'number' && res.lastSeq > lastSeq) {
                    lastSeq = res.lastSeq;
                }
                for (var i = 0; i < res.messages.length; i++) {
                    var item = res.messages[i];
                    if (item && item.payload) onPayload(item.payload);
                }
            }, 650);

            if (typeof onReady === 'function') {
                global.setTimeout(function () { if (active) onReady('SUBSCRIBED'); }, 10);
            }

            return {
                send: function (payload) {
                    return TVApp.db.rtcSend(channelKey, payload);
                },
                close: function () {
                    active = false;
                    if (pollHandle) global.clearInterval(pollHandle);
                    pollHandle = null;
                }
            };
        }

        var client = TVApp.db && TVApp.db.getRawClient ? TVApp.db.getRawClient() : null;
        if (!client) return null;

        var ch = client.channel(channelKey, { config: { broadcast: { self: false } } });
        ch.on('broadcast', { event: 'rtc' }, function (msg) {
            if (msg && msg.payload) onPayload(msg.payload);
        });
        ch.subscribe(function (status) {
            if (typeof onReady === 'function') onReady(status);
        });

        return {
            send: function (payload) {
                return ch.send({ type: 'broadcast', event: 'rtc', payload: payload });
            },
            close: function () {
                try {
                    if (typeof client.removeChannel === 'function') client.removeChannel(ch);
                    else if (typeof ch.unsubscribe === 'function') ch.unsubscribe();
                } catch (e) {}
            }
        };
    }

    /* --- TV Receiver Controller --- */
    var receiver = {
        bridge: null,
        pc: null,
        channelKey: null,
        activeSenderId: null,
        pendingIce: [],
        disconnectTimer: null,
        callbacks: {}
    };

    function cleanupReceiverPeer() {
        receiver.activeSenderId = null;
        receiver.pendingIce = [];
        if (receiver.disconnectTimer) {
            global.clearTimeout(receiver.disconnectTimer);
            receiver.disconnectTimer = null;
        }
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
        if (receiver.bridge) {
            receiver.bridge.close();
            receiver.bridge = null;
        }
        receiver.channelKey = null;
    }

    async function handleReceiverOffer(payload) {
        if (!payload || !payload.sdp || !payload.senderId) return;
        if (typeof global.RTCPeerConnection !== 'function') return;
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
            if (!event.candidate || !receiver.bridge) return;
            receiver.bridge.send({
                kind: 'ice',
                from: 'tv',
                senderId: receiver.activeSenderId,
                candidate: event.candidate
            });
        };

        pc.oniceconnectionstatechange = function () {
            var st = pc.iceConnectionState;
            if (st === 'connected' || st === 'completed') {
                if (receiver.disconnectTimer) {
                    global.clearTimeout(receiver.disconnectTimer);
                    receiver.disconnectTimer = null;
                }
                return;
            }
            if (st === 'disconnected') {
                if (!receiver.disconnectTimer) {
                    receiver.disconnectTimer = global.setTimeout(function () {
                        receiver.disconnectTimer = null;
                        if (receiver.pc && receiver.pc.iceConnectionState === 'disconnected') {
                            cleanupReceiverPeer();
                            if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
                        }
                    }, 4000);
                }
                return;
            }
            if (st === 'failed' || st === 'closed') {
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
            if (receiver.bridge) {
                await receiver.bridge.send({
                    kind: 'answer',
                    from: 'tv',
                    senderId: receiver.activeSenderId,
                    sdp: answer
                });
            }
        } catch (err) {
            cleanupReceiverPeer();
            if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
        }
    }

    async function startReceiver(room, pin, callbacks) {
        receiver.callbacks = callbacks || {};

        var key = makeChannelName(room, pin);
        if (receiver.channelKey === key && receiver.bridge) return;

        stopReceiver();
        receiver.channelKey = key;

        receiver.bridge = await createSignalingBridge(key, function (p) {
            if (!p || p.from === 'tv') return;

            if (p.type === 'media-start' && p.media) {
                if (typeof receiver.callbacks.onMediaStart === 'function') receiver.callbacks.onMediaStart(p.media);
                return;
            }
            if (p.type === 'media-control') {
                if (typeof receiver.callbacks.onMediaControl === 'function') receiver.callbacks.onMediaControl(p.action, p.media);
                return;
            }
            if (p.type === 'media-stop') {
                if (typeof receiver.callbacks.onMediaStop === 'function') receiver.callbacks.onMediaStop();
                return;
            }

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
        }, function (status) {
            if (typeof receiver.callbacks.onChannelStatus === 'function') {
                receiver.callbacks.onChannelStatus(status);
            }
        });
    }

    function stopBroadcastFromTv() {
        var senderId = receiver.activeSenderId;
        if (receiver.bridge && senderId) {
            try {
                receiver.bridge.send({ kind: 'stop', from: 'tv', senderId: senderId });
            } catch (e) {}
        }
        cleanupReceiverPeer();
        if (typeof receiver.callbacks.onStop === 'function') receiver.callbacks.onStop();
    }

    /* --- Laptop / Mobile Sender Controller --- */
    var sender = {
        bridge: null,
        pc: null,
        stream: null,
        senderId: null,
        pendingIce: [],
        disconnectTimer: null,
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
        if (sender.disconnectTimer) {
            global.clearTimeout(sender.disconnectTimer);
            sender.disconnectTimer = null;
        }
        if (notifyRemote && sender.bridge && sender.senderId) {
            try {
                sender.bridge.send({ kind: 'stop', from: 'laptop', senderId: sender.senderId });
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
        if (sender.bridge) {
            sender.bridge.close();
            sender.bridge = null;
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

        pc.onicecandidate = function (event) {
            if (!event.candidate || !sender.bridge) return;
            sender.bridge.send({
                kind: 'ice',
                from: 'laptop',
                senderId: sender.senderId,
                candidate: event.candidate
            });
        };

        pc.oniceconnectionstatechange = function () {
            var st = pc.iceConnectionState;
            if (st === 'connected' || st === 'completed') {
                if (sender.disconnectTimer) {
                    global.clearTimeout(sender.disconnectTimer);
                    sender.disconnectTimer = null;
                }
                if (typeof sender.callbacks.onState === 'function') sender.callbacks.onState('connected');
            } else if (st === 'disconnected') {
                if (!sender.disconnectTimer) {
                    sender.disconnectTimer = global.setTimeout(function () {
                        sender.disconnectTimer = null;
                        if (sender.pc && sender.pc.iceConnectionState === 'disconnected') stopSender(false);
                    }, 4000);
                }
            } else if (st === 'failed' || st === 'closed') {
                stopSender(false);
            }
        };

        var key = makeChannelName(room, pin);
        sender.bridge = await createSignalingBridge(key, async function (p) {
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
        }, async function (status) {
            if (status === 'SUBSCRIBED') {
                try {
                    var offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    if (sender.bridge) {
                        await sender.bridge.send({
                            kind: 'offer',
                            from: 'laptop',
                            senderId: sender.senderId,
                            sdp: offer
                        });
                    }
                } catch (err2) {
                    stopSender(false);
                    if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('SIGNAL_FAILED');
                }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                stopSender(false);
                if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('SIGNAL_FAILED');
            }
        });

        if (!sender.bridge) {
            stopSender(false);
            if (typeof sender.callbacks.onError === 'function') sender.callbacks.onError('NO_SIGNALING');
        }
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
