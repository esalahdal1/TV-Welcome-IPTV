#!/usr/bin/env python3
"""Local Office & Hotel Backend Server for Masaken Al-Nuzha TVIP.

Serves static web assets alongside a persistent JSON REST API (/api/*)
for rooms, PIN pairing/rotation, room service requests, TV notifications,
hotel settings, staff authentication, and local WebRTC signaling.
"""

import hashlib
import http.server
import json
import os
import random
import signal
import sys
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_hotel_db.json")

DEFAULT_SETTINGS = {
    "wifi_name": "Masaken_Guest",
    "wifi_pass": "Masaken@2026",
    "reception_ext": "0 / 100",
    "breakfast_hours": "07:00 - 10:30",
    "checkout_time": "14:00",
}

BLOCKED_PREFIXES = (".git/", "mvp/", "scripts/local_hotel_db.json")

db_lock = threading.Lock()
rtc_lock = threading.Lock()
rtc_channels = {}
rtc_seq = 0


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def gen_pin() -> str:
    return str(random.randint(1000, 9999))


def default_db() -> dict:
    return {
        "staff_pin_hash": sha256_hex("1234"),
        "hotel_settings": dict(DEFAULT_SETTINGS),
        "guests": {},
        "requests": [],
        "notifications": [],
    }


def load_db() -> dict:
    if not os.path.exists(DB_PATH):
        data = default_db()
        save_db(data)
        return data
    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("invalid db root")
        data.setdefault("staff_pin_hash", sha256_hex("1234"))
        data.setdefault("hotel_settings", dict(DEFAULT_SETTINGS))
        data.setdefault("guests", {})
        data.setdefault("requests", [])
        data.setdefault("notifications", [])
        return data
    except Exception:
        data = default_db()
        save_db(data)
        return data


def save_db(data: dict) -> None:
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DB_PATH)


def normalize_digits(s: str) -> str:
    trans = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
    return str(s or "").translate(trans).strip()


def sort_room_key(g: dict):
    room = str(g.get("room_number", ""))
    return (0, int(room)) if room.isdigit() else (1, room)


class HotelRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, code: int, payload) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > 2_000_000:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def verify_staff(self, data: dict, pin: str) -> bool:
        clean = normalize_digits(pin)
        return bool(clean) and sha256_hex(clean) == data.get("staff_pin_hash")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed.path, urllib.parse.parse_qs(parsed.query))
            return

        rel = urllib.parse.unquote(parsed.path.lstrip("/"))
        for bad in BLOCKED_PREFIXES:
            if rel == bad or rel.startswith(bad):
                self.send_error(403, "Forbidden")
                return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(405, "Method Not Allowed")
            return
        self.handle_api_post(parsed.path)

    def handle_api_get(self, path: str, qs: dict):
        if path == "/api/health":
            self.send_json(200, {"ok": True, "mode": "local", "time": now_iso()})
            return

        if path == "/api/settings":
            with db_lock:
                data = load_db()
                self.send_json(200, data.get("hotel_settings", DEFAULT_SETTINGS))
            return

        if path == "/api/guest":
            room = normalize_digits((qs.get("room") or [""])[0])
            if not room:
                self.send_json(200, None)
                return
            with db_lock:
                data = load_db()
                g = data["guests"].get(room)
                self.send_json(200, g if g else None)
            return

        if path == "/api/requests":
            room = normalize_digits((qs.get("room") or [""])[0])
            status = (qs.get("status") or [""])[0].strip().lower()
            with db_lock:
                data = load_db()
                rows = list(data.get("requests", []))
            if room:
                rows = [r for r in rows if str(r.get("room_number", "")) == room]
            if status:
                rows = [r for r in rows if str(r.get("status", "")) == status]
            rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
            self.send_json(200, rows[:80])
            return

        if path == "/api/notifications":
            room = normalize_digits((qs.get("room") or [""])[0])
            after = (qs.get("after") or [""])[0].strip()
            latest_only = (qs.get("latest") or [""])[0].strip() == "1"
            with db_lock:
                data = load_db()
                rows = list(data.get("notifications", []))
            if room:
                rows = [r for r in rows if r.get("room_number") in (None, "", room)]
            else:
                rows = [r for r in rows if r.get("room_number") in (None, "")]
            if after:
                rows = [r for r in rows if str(r.get("created_at", "")) > after]
            rows.sort(key=lambda r: str(r.get("created_at", "")))
            if latest_only:
                self.send_json(200, rows[-1:] if rows else [])
            else:
                self.send_json(200, rows[-20:])
            return

        if path == "/api/notifications/latest-global":
            with db_lock:
                data = load_db()
                rows = [r for r in data.get("notifications", []) if r.get("room_number") in (None, "")]
            rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
            self.send_json(200, rows[0] if rows else None)
            return

        if path == "/api/rtc/poll":
            channel = (qs.get("channel") or [""])[0].strip()
            try:
                after = int((qs.get("after") or ["0"])[0])
            except ValueError:
                after = 0
            with rtc_lock:
                items = rtc_channels.get(channel, [])
                matched = [{"seq": s, "payload": p} for (s, p) in items if s > after]
                last_seq = items[-1][0] if items else after
            self.send_json(200, {"messages": matched, "lastSeq": last_seq})
            return

        self.send_json(404, {"error": {"message": "Endpoint not found"}})

    def handle_api_post(self, path: str):
        body = self.read_json_body()

        if path == "/api/guest/sync-pin":
            room = normalize_digits(body.get("room"))
            pin = normalize_digits(body.get("pin"))
            if not room or len(pin) != 4 or not pin.isdigit():
                self.send_json(400, {"error": {"message": "Invalid room or PIN"}})
                return
            with db_lock:
                data = load_db()
                g = data["guests"].get(room)
                if not g:
                    g = {
                        "room_number": room,
                        "full_name": "",
                        "cast_pin": pin,
                        "preferred_lang": "ar",
                    }
                    data["guests"][room] = g
                    save_db(data)
                elif not g.get("cast_pin"):
                    g["cast_pin"] = pin
                    save_db(data)
                self.send_json(200, g)
            return

        if path == "/api/verify-pin":
            room = normalize_digits(body.get("room"))
            pin = normalize_digits(body.get("pin"))
            if not room or len(pin) != 4 or not pin.isdigit():
                self.send_json(200, {"valid": False, "full_name": None, "preferred_lang": "ar"})
                return
            with db_lock:
                data = load_db()
                g = data["guests"].get(room)
                if not g or not g.get("cast_pin"):
                    self.send_json(200, {"valid": False, "full_name": None, "preferred_lang": "ar"})
                    return
                valid = str(g.get("cast_pin", "")).strip() == pin
                self.send_json(
                    200,
                    {
                        "valid": valid,
                        "full_name": (g.get("full_name") or None) if valid else None,
                        "preferred_lang": g.get("preferred_lang") or "ar",
                    },
                )
            return

        if path == "/api/requests":
            room = normalize_digits(body.get("room_number"))
            req_type = str(body.get("request_type") or "").strip()
            if not room or not req_type:
                self.send_json(400, {"error": {"message": "رقم الغرفة ونوع الطلب مطلوبان"}})
                return
            row = {
                "id": str(uuid.uuid4()),
                "room_number": room,
                "request_type": req_type,
                "status": "pending",
                "created_at": now_iso(),
                "completed_at": None,
            }
            with db_lock:
                data = load_db()
                data["requests"].append(row)
                save_db(data)
            self.send_json(200, {"data": [row], "error": None})
            return

        if path == "/api/rtc/send":
            global rtc_seq
            channel = str(body.get("channel") or "").strip()
            payload = body.get("payload")
            if not channel or not isinstance(payload, dict):
                self.send_json(400, {"error": {"message": "Invalid RTC payload"}})
                return
            with rtc_lock:
                rtc_seq += 1
                seq = rtc_seq
                buf = rtc_channels.setdefault(channel, [])
                buf.append((seq, payload))
                if len(buf) > 50:
                    del buf[:-50]
            self.send_json(200, {"ok": True, "seq": seq})
            return

        if path == "/api/staff/login":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                ok = self.verify_staff(data, pin)
            self.send_json(200, {"ok": ok, "localMode": True})
            return

        if path == "/api/staff/guests":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"data": None, "error": {"message": "رمز الموظف غير صحيح"}})
                    return
                guests = sorted(data.get("guests", {}).values(), key=sort_room_key)
            self.send_json(200, {"data": guests, "error": None, "localMode": True})
            return

        if path == "/api/staff/checkin":
            pin = normalize_digits(body.get("pin"))
            room = normalize_digits(body.get("room"))
            full_name = str(body.get("full_name") or "").strip()
            lang = "en" if body.get("lang") == "en" else "ar"
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"data": None, "error": {"message": "رمز الموظف غير صحيح"}})
                    return
                if not room:
                    self.send_json(400, {"data": None, "error": {"message": "رقم الغرفة مطلوب"}})
                    return
                row = {
                    "room_number": room,
                    "full_name": full_name,
                    "cast_pin": gen_pin(),
                    "preferred_lang": lang,
                }
                data["guests"][room] = row
                save_db(data)
            self.send_json(200, {"data": row, "error": None})
            return

        if path == "/api/staff/checkout":
            pin = normalize_digits(body.get("pin"))
            room = normalize_digits(body.get("room"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"data": None, "error": {"message": "رمز الموظف غير صحيح"}})
                    return
                old = data["guests"].get(room, {})
                row = {
                    "room_number": room,
                    "full_name": "",
                    "cast_pin": gen_pin(),
                    "preferred_lang": old.get("preferred_lang", "ar"),
                }
                data["guests"][room] = row
                save_db(data)
            self.send_json(200, {"data": row, "error": None})
            return

        if path == "/api/staff/notify":
            pin = normalize_digits(body.get("pin"))
            target_room = normalize_digits(body.get("room"))
            msg = str(body.get("message") or "").strip()
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                if not msg:
                    self.send_json(400, {"error": {"message": "نص الإشعار مطلوب"}})
                    return
                row = {
                    "id": str(uuid.uuid4()),
                    "room_number": target_room or None,
                    "message": msg,
                    "created_at": now_iso(),
                }
                data["notifications"].append(row)
                save_db(data)
            self.send_json(200, {"error": None, "data": row})
            return

        if path == "/api/staff/notifications":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"data": [], "error": {"message": "رمز الموظف غير صحيح"}})
                    return
                rows = list(data.get("notifications", []))
            rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
            self.send_json(200, {"data": rows[:20], "error": None})
            return

        if path == "/api/staff/complete-request":
            pin = normalize_digits(body.get("pin"))
            req_id = str(body.get("request_id") or "").strip()
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                for r in data.get("requests", []):
                    if str(r.get("id")) == req_id:
                        r["status"] = "done"
                        r["completed_at"] = now_iso()
                        break
                save_db(data)
            self.send_json(200, {"error": None})
            return

        if path == "/api/staff/settings":
            pin = normalize_digits(body.get("pin"))
            settings = body.get("settings") or {}
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                cur = data.setdefault("hotel_settings", dict(DEFAULT_SETTINGS))
                for k in DEFAULT_SETTINGS:
                    val = str(settings.get(k) or "").strip()
                    if val:
                        cur[k] = val
                save_db(data)
            self.send_json(200, {"error": None})
            return

        if path == "/api/staff/change-pin":
            old_pin = normalize_digits(body.get("old_pin"))
            new_pin = normalize_digits(body.get("new_pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, old_pin):
                    self.send_json(401, {"error": {"message": "الرمز الحالي غير صحيح"}})
                    return
                if len(new_pin) < 4:
                    self.send_json(400, {"error": {"message": "الرمز الجديد يجب أن يكون 4 خانات فأكثر"}})
                    return
                data["staff_pin_hash"] = sha256_hex(new_pin)
                save_db(data)
            self.send_json(200, {"error": None})
            return

        self.send_json(404, {"error": {"message": "Endpoint not found"}})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    bind_host = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"

    def shutdown_handler(_sig, _frame):
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    server = http.server.ThreadingHTTPServer((bind_host, port), HotelRequestHandler)
    print(f"Masaken Al-Nuzha Local Server running on http://{bind_host}:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
