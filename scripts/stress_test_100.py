#!/usr/bin/env python3
"""
Masaken TVIP - 100-TV load test against the local hotel server.

Phases:
  1) BURST     : N virtual TVs cold-start at the same instant (portal + APIs + 1 MB video).
  2) SUSTAINED : N virtual TVs run for --duration seconds with the real app cadence
                 (guest 10s, heartbeat 14s, notifications 20s, 1 MB video chunk every 10s).
                 Meanwhile a "staff" thread polls /api/staff/screens every 5s and
                 sends a remote command to every virtual TV to verify delivery.
  3) CLEANUP   : removes all simulator screens (/api/staff/screens/clear-sim).

Virtual TVs use platform="simulator" (screen ids sim-301..sim-400) so they never
touch real Android TV records (room-101 etc.).

Usage:
  python3 scripts/stress_test_100.py --base http://192.168.1.50 --tvs 100 --duration 120
  python3 scripts/stress_test_100.py --keep   # do not clear sim screens at the end
"""
import argparse
import concurrent.futures
import json
import statistics
import threading
import time
import urllib.request

ROOM_OFFSET = 300


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[min(len(s) - 1, int(len(s) * p))]


def summarize(name, vals):
    if not vals:
        return f"{name}: n=0"
    return (f"{name}: n={len(vals)} median={statistics.median(vals):.0f}ms "
            f"p95={pct(vals, 0.95):.0f}ms max={max(vals):.0f}ms")


class Http:
    def __init__(self, base, timeout=20):
        self.base = base.rstrip("/")
        self.timeout = timeout

    def call(self, method, path, body=None, headers=None):
        """Returns (ok, status, latency_ms, bytes, json_or_None)."""
        h = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        t = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                raw = r.read()
                lat = (time.perf_counter() - t) * 1000.0
                js = None
                if r.headers.get("Content-Type", "").startswith("application/json"):
                    try:
                        js = json.loads(raw.decode())
                    except Exception:
                        js = None
                return (200 <= r.status < 300), r.status, lat, len(raw), js
        except urllib.error.HTTPError as e:
            return False, e.code, (time.perf_counter() - t) * 1000.0, 0, None
        except Exception:
            return False, 0, (time.perf_counter() - t) * 1000.0, 0, None


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.lat = {}
        self.ok = 0
        self.fail = 0
        self.fail_by = {}
        self.video_bytes = 0
        self.cmds_received = {}

    def add(self, kind, ok, lat, nbytes=0, status=0):
        with self.lock:
            self.lat.setdefault(kind, []).append(lat)
            if ok:
                self.ok += 1
            else:
                self.fail += 1
                key = f"{kind}:{status}"
                self.fail_by[key] = self.fail_by.get(key, 0) + 1
            if kind == "video" and ok:
                self.video_bytes += nbytes


def heartbeat_body(idx):
    room = str(ROOM_OFFSET + idx)
    return {"room": room, "mode": "room", "screen_state": "live_tv", "app_version": "loadtest",
            "platform": "simulator", "device_id": f"load-{idx}"}


# ---------------------------------------------------------------- burst
def burst(http, n):
    st = Stats()

    def one(idx):
        room = str(ROOM_OFFSET + idx)
        for kind, m, p, b in [
            ("index", "GET", "/index.html", None),
            ("widgets", "GET", "/api/widgets", None),
            ("guest", "GET", f"/api/guest?room={room}", None),
            ("settings", "GET", "/api/settings", None),
            ("notif", "GET", f"/api/notifications?room={room}&latest=1", None),
            ("m3u", "GET", "/api/channels.m3u", None),
            ("heartbeat", "POST", "/api/tv/heartbeat", heartbeat_body(idx)),
        ]:
            ok, s, lat, nb, _ = http.call(m, p, b)
            st.add(kind, ok, lat, nb, s)
        ok, s, lat, nb, _ = http.call("GET", "/api/channel1/video", headers={"Range": "bytes=0-1048575"})
        st.add("video", ok and nb > 0, lat, nb, s)

    t0 = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(one, range(1, n + 1)))
    wall = time.perf_counter() - t0
    return st, wall


# ---------------------------------------------------------------- sustained
def sustained(http, n, duration, pin):
    st = Stats()
    stop = threading.Event()
    online_samples = []
    cmd_sent = {"count": 0, "ok": False, "at": None}

    def tv_loop(idx):
        room = str(ROOM_OFFSET + idx)
        # stagger start like real TVs booting over ~10s
        time.sleep((idx % 10))
        next_t = {"guest": 0, "heartbeat": 0, "notif": 0, "video": 0}
        period = {"guest": 10, "heartbeat": 14, "notif": 20, "video": 10}
        start = time.time()
        while not stop.is_set():
            now = time.time() - start
            for kind in ("heartbeat", "guest", "notif", "video"):
                if now < next_t[kind] or stop.is_set():
                    continue
                next_t[kind] = now + period[kind]
                if kind == "heartbeat":
                    ok, s, lat, nb, js = http.call("POST", "/api/tv/heartbeat", heartbeat_body(idx))
                    st.add(kind, ok, lat, nb, s)
                    if ok and js and js.get("commands"):
                        with st.lock:
                            st.cmds_received[idx] = time.time()
                elif kind == "guest":
                    ok, s, lat, nb, _ = http.call("GET", f"/api/guest?room={room}")
                    st.add(kind, ok, lat, nb, s)
                elif kind == "notif":
                    ok, s, lat, nb, _ = http.call("GET", f"/api/notifications?room={room}&latest=1")
                    st.add(kind, ok, lat, nb, s)
                else:
                    ok, s, lat, nb, _ = http.call("GET", "/api/channel1/video",
                                                  headers={"Range": "bytes=0-1048575"})
                    st.add(kind, ok and nb > 0, lat, nb, s)
            stop.wait(0.5)

    def staff_loop():
        start = time.time()
        while not stop.is_set():
            ok, s, lat, _, js = http.call("POST", "/api/staff/screens", {"pin": pin})
            st.add("staff_screens", ok, lat, 0, s)
            if ok and js:
                sims_online = sum(1 for x in js.get("screens", [])
                                  if x.get("online") and str(x.get("screen_id", "")).startswith("sim-")
                                  and x.get("app_version") == "loadtest")
                online_samples.append((round(time.time() - start), sims_online, js.get("online_count")))
            # halfway: push a remote command to every virtual TV (sim targets only, never real TVs)
            if not cmd_sent["ok"] and time.time() - start > duration / 2:
                sent = 0
                for i in range(1, n + 1):
                    ok2, *_ = http.call("POST", "/api/staff/screens/command",
                                        {"pin": pin, "target": f"sim-{ROOM_OFFSET + i}", "command": "open_portal"})
                    sent += 1 if ok2 else 0
                cmd_sent.update(count=sent, ok=True, at=time.time())
            stop.wait(5)

    threads = [threading.Thread(target=tv_loop, args=(i,), daemon=True) for i in range(1, n + 1)]
    threads.append(threading.Thread(target=staff_loop, daemon=True))
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    time.sleep(duration)
    stop.set()
    for t in threads:
        t.join(timeout=30)
    wall = time.perf_counter() - t0

    delivered = [ts - cmd_sent["at"] for ts in st.cmds_received.values()] if cmd_sent["at"] else []
    return st, wall, online_samples, cmd_sent, delivered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://192.168.1.50")
    ap.add_argument("--tvs", type=int, default=100)
    ap.add_argument("--duration", type=int, default=120)
    ap.add_argument("--pin", default="1234")
    ap.add_argument("--keep", action="store_true", help="keep sim screens after test (for screenshots)")
    ap.add_argument("--skip-burst", action="store_true")
    ap.add_argument("--json-out", default="")
    a = ap.parse_args()
    http = Http(a.base)
    report = {"base": a.base, "tvs": a.tvs, "duration": a.duration, "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    if not a.skip_burst:
        print(f"=== PHASE 1: BURST - {a.tvs} TVs cold-start simultaneously ===", flush=True)
        st, wall = burst(http, a.tvs)
        print(f"BURST_WALL_SEC: {wall:.2f}")
        print(f"BURST_REQUESTS_OK: {st.ok}/{st.ok + st.fail}  fails={st.fail_by or 0}")
        api = [x for k, v in st.lat.items() if k != "video" for x in v]
        print(summarize("BURST_API", api))
        print(summarize("BURST_VIDEO_1MB", st.lat.get("video", [])))
        print(f"BURST_VIDEO_MB: {st.video_bytes / 1048576:.1f} MB  ({st.video_bytes * 8 / wall / 1e6:.1f} Mbps)", flush=True)
        report["burst"] = {"wall_sec": round(wall, 2), "ok": st.ok, "fail": st.fail, "fail_by": st.fail_by,
                           "api_median_ms": round(statistics.median(api), 1), "api_p95_ms": round(pct(api, .95), 1),
                           "video_median_ms": round(statistics.median(st.lat["video"]), 1),
                           "video_p95_ms": round(pct(st.lat["video"], .95), 1),
                           "video_mbps": round(st.video_bytes * 8 / wall / 1e6, 1)}

    print(f"\n=== PHASE 2: SUSTAINED - {a.tvs} TVs for {a.duration}s (real app cadence) ===", flush=True)
    st, wall, samples, cmd, delivered = sustained(http, a.tvs, a.duration, a.pin)
    total = st.ok + st.fail
    print(f"SUSTAINED_WALL_SEC: {wall:.1f}")
    print(f"SUSTAINED_REQUESTS_OK: {st.ok}/{total} ({100.0 * st.ok / max(1, total):.2f}%)  fails={st.fail_by or 0}")
    print(f"SUSTAINED_RPS: {total / wall:.1f} req/s")
    for k in ("heartbeat", "guest", "notif", "staff_screens", "video"):
        print(summarize(f"SUSTAINED_{k.upper()}", st.lat.get(k, [])))
    print(f"SUSTAINED_VIDEO: {st.video_bytes / 1048576:.0f} MB delivered ({st.video_bytes * 8 / wall / 1e6:.1f} Mbps avg)")
    peak = max((s[1] for s in samples), default=0)
    print(f"MONITOR_SIM_ONLINE_PEAK: {peak}/{a.tvs}   samples(t,sim_online,total_online)={samples}")
    print(f"REMOTE_CMD: sent={cmd['count']}  received_by={len(delivered)}/{a.tvs}  "
          f"delivery median={statistics.median(delivered) if delivered else 0:.1f}s max={max(delivered) if delivered else 0:.1f}s",
          flush=True)
    report["sustained"] = {
        "wall_sec": round(wall, 1), "ok": st.ok, "fail": st.fail, "fail_by": st.fail_by,
        "rps": round(total / wall, 1),
        "lat": {k: {"median": round(statistics.median(v), 1), "p95": round(pct(v, .95), 1), "max": round(max(v), 1)}
                for k, v in st.lat.items() if v},
        "video_mb": round(st.video_bytes / 1048576, 1), "video_mbps": round(st.video_bytes * 8 / wall / 1e6, 1),
        "monitor_peak_online": peak, "monitor_samples": samples,
        "cmd_sent": cmd["count"], "cmd_received": len(delivered),
        "cmd_delivery_median_s": round(statistics.median(delivered), 1) if delivered else None,
        "cmd_delivery_max_s": round(max(delivered), 1) if delivered else None,
    }

    if not a.keep:
        ok, s, lat, _, js = http.call("POST", "/api/staff/screens/clear-sim", {"pin": a.pin})
        print(f"\nCLEANUP clear-sim: ok={ok} removed={js.get('removed') if js else '?'}")
    if a.json_out:
        with open(a.json_out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"JSON report -> {a.json_out}")


if __name__ == "__main__":
    main()
