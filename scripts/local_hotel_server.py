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
import re
import signal
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_hotel_db.json")
MEDIA_DIR = os.path.join(tempfile.gettempdir(), "tvip_cast_media")
os.makedirs(MEDIA_DIR, exist_ok=True)

DEFAULT_SETTINGS = {
    "wifi_name": "Masaken_Guest",
    "wifi_pass": "Masaken@2026",
    "reception_ext": "0 / 100",
    "breakfast_hours": "07:00 - 10:30",
    "checkout_time": "14:00",
}

BLOCKED_PREFIXES = (".git/", "mvp/", "scripts/local_hotel_db.json")
PUBLIC_URL = str(os.environ.get("TVIP_PUBLIC_URL") or "").strip().rstrip("/")
MAX_MEDIA_BYTES = 150 * 1024 * 1024
ALLOWED_MEDIA_MIME = {
    "image/jpeg": ("image", ".jpg"),
    "image/jpg": ("image", ".jpg"),
    "image/png": ("image", ".png"),
    "image/webp": ("image", ".webp"),
    "image/gif": ("image", ".gif"),
    "video/mp4": ("video", ".mp4"),
    "video/quicktime": ("video", ".mov"),
    "video/webm": ("video", ".webm"),
    "video/x-m4v": ("video", ".m4v"),
}
ALLOWED_EXT_TO_MIME = {
    ".jpg": ("image", "image/jpeg"),
    ".jpeg": ("image", "image/jpeg"),
    ".png": ("image", "image/png"),
    ".webp": ("image", "image/webp"),
    ".gif": ("image", "image/gif"),
    ".mp4": ("video", "video/mp4"),
    ".mov": ("video", "video/quicktime"),
    ".webm": ("video", "video/webm"),
    ".m4v": ("video", "video/mp4"),
}

db_lock = threading.Lock()
rtc_lock = threading.Lock()
rtc_channels = {}
rtc_seq = 0
media_lock = threading.Lock()
media_cast_state = {}
media_seq = 0


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


def push_rtc_signal(channel: str, payload: dict) -> int:
    """Append a signaling payload to an in-memory room channel and return its sequence id."""
    global rtc_seq
    with rtc_lock:
        rtc_seq += 1
        seq = rtc_seq
        buf = rtc_channels.setdefault(channel, [])
        buf.append((seq, payload))
        if len(buf) > 50:
            del buf[:-50]
    return seq


def verify_room_pin_db(room: str, pin: str) -> bool:
    """Check whether room + 4-digit PIN match the active guest record."""
    clean_room = normalize_digits(room)
    clean_pin = normalize_digits(pin)
    if not clean_room or len(clean_pin) != 4 or not clean_pin.isdigit():
        return False
    with db_lock:
        data = load_db()
        g = data.get("guests", {}).get(clean_room)
        return bool(g and str(g.get("cast_pin", "")).strip() == clean_pin)


def public_media_meta(entry: dict, pin: str) -> dict:
    """Build JSON-safe metadata returned to TV and mobile clients."""
    room = entry["room"]
    tok = entry["id"]
    return {
        "id": tok,
        "room": room,
        "kind": entry["kind"],
        "mime": entry["mime"],
        "filename": entry["filename"],
        "size": entry["size"],
        "version": entry["version"],
        "paused": bool(entry.get("paused", False)),
        "muted": bool(entry.get("muted", False)),
        "url": f"/api/media/file?room={urllib.parse.quote(room)}&pin={urllib.parse.quote(pin)}&id={urllib.parse.quote(tok)}",
    }


def clear_room_media(room: str, notify_pin: str = "") -> None:
    """Remove active cast media for a room and unlink its temporary file."""
    clean_room = normalize_digits(room)
    if not clean_room:
        return
    with media_lock:
        prev = media_cast_state.pop(clean_room, None)
    if prev and prev.get("path"):
        try:
            if os.path.exists(prev["path"]):
                os.unlink(prev["path"])
        except OSError:
            pass
    if notify_pin:
        push_rtc_signal(f"tvip-cast-{clean_room}-{notify_pin}", {"type": "media-stop"})


class HotelRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        if args and "/api/rtc/poll" in str(args[0]):
            return
        super().log_message(format, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, Range, X-File-Name")
        self.send_header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/media/file":
            self.serve_media_file(urllib.parse.parse_qs(parsed.query), head_only=True)
            return
        super().do_HEAD()

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
        if parsed.path == "/api/media/upload":
            self.handle_media_upload(urllib.parse.parse_qs(parsed.query))
            return
        if not parsed.path.startswith("/api/"):
            self.send_error(405, "Method Not Allowed")
            return
        self.handle_api_post(parsed.path)

    def serve_media_file(self, qs: dict, head_only: bool = False):
        """Serve the currently active room cast media with HTTP Range (206) support."""
        room = normalize_digits((qs.get("room") or [""])[0])
        pin = normalize_digits((qs.get("pin") or [""])[0])
        media_id = (qs.get("id") or [""])[0].strip()
        if not verify_room_pin_db(room, pin):
            self.send_json(403, {"error": {"message": "رمز الغرفة غير صحيح"}})
            return
        with media_lock:
            entry = media_cast_state.get(room)
        if not entry or entry.get("id") != media_id or not os.path.exists(entry.get("path", "")):
            self.send_json(404, {"error": {"message": "لا يوجد محتوى نشط"}})
            return

        file_path = entry["path"]
        file_size = os.path.getsize(file_path)
        mime = entry.get("mime") or "application/octet-stream"
        range_hdr = self.headers.get("Range")
        start = 0
        end = file_size - 1
        status = 200

        if range_hdr and file_size > 0:
            m = re.match(r"bytes=(\d*)-(\d*)", range_hdr.strip())
            if m:
                s_str, e_str = m.group(1), m.group(2)
                if s_str:
                    start = int(s_str)
                    end = int(e_str) if e_str else file_size - 1
                elif e_str:
                    suffix = int(e_str)
                    start = max(0, file_size - suffix)
                    end = file_size - 1
                if start >= file_size or end < start:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    self.end_headers()
                    return
                end = min(end, file_size - 1)
                status = 206

        length = max(0, end - start + 1) if file_size > 0 else 0
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()
        if head_only or length == 0:
            return

        try:
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_media_upload(self, qs: dict):
        """Stream an uploaded photo or video from a verified room guest to temp storage."""
        global media_seq
        room = normalize_digits((qs.get("room") or [""])[0])
        pin = normalize_digits((qs.get("pin") or [""])[0])
        if not verify_room_pin_db(room, pin):
            self.send_json(403, {"error": {"message": "رمز الغرفة غير صحيح أو انتهت الجلسة"}})
            return

        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_MEDIA_BYTES:
            self.send_json(400, {"error": {"message": "حجم الملف غير مسموح (الحد الأقصى 150 ميجابايت)"}})
            return

        raw_name = urllib.parse.unquote((qs.get("name") or [self.headers.get("X-File-Name") or "media"])[0]).strip()
        filename = os.path.basename(raw_name)[:80] or "media"
        raw_ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        ext = os.path.splitext(filename)[1].lower()

        if raw_ct in ALLOWED_MEDIA_MIME:
            kind, suffix = ALLOWED_MEDIA_MIME[raw_ct]
            mime = "image/jpeg" if raw_ct == "image/jpg" else raw_ct
        elif ext in ALLOWED_EXT_TO_MIME:
            kind, mime = ALLOWED_EXT_TO_MIME[ext]
            suffix = ext
        else:
            self.send_json(415, {"error": {"message": "صيغة الملف غير مدعومة. استخدم صور JPG/PNG أو فيديو MP4/MOV/WebM"}})
            return

        tok = uuid.uuid4().hex[:16]
        dest_path = os.path.join(MEDIA_DIR, f"room_{room}_{tok}{suffix}")
        try:
            remaining = length
            written = 0
            with open(dest_path, "wb") as out:
                while remaining > 0:
                    chunk = self.rfile.read(min(65536, remaining))
                    if not chunk:
                        break
                    out.write(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)
            if written != length:
                try:
                    os.unlink(dest_path)
                except OSError:
                    pass
                self.send_json(400, {"error": {"message": "انقطع رفع الملف قبل اكتماله"}})
                return
        except Exception:
            try:
                if os.path.exists(dest_path):
                    os.unlink(dest_path)
            except OSError:
                pass
            self.send_json(500, {"error": {"message": "تعذر حفظ الملف على السيرفر"}})
            return

        with media_lock:
            media_seq += 1
            ver = media_seq
            prev = media_cast_state.get(room)
            entry = {
                "id": tok,
                "room": room,
                "kind": kind,
                "mime": mime,
                "filename": filename,
                "size": written,
                "version": ver,
                "paused": False,
                "muted": False,
                "path": dest_path,
                "created_at": now_iso(),
            }
            media_cast_state[room] = entry
            meta = public_media_meta(entry, pin)

        if prev and prev.get("path") and prev["path"] != dest_path:
            try:
                if os.path.exists(prev["path"]):
                    os.unlink(prev["path"])
            except OSError:
                pass

        push_rtc_signal(f"tvip-cast-{room}-{pin}", {"type": "media-start", "media": meta})
        self.send_json(200, {"ok": True, "media": meta})

    def handle_api_get(self, path: str, qs: dict):
        if path == "/api/health":
            self.send_json(200, {"ok": True, "mode": "local", "time": now_iso()})
            return

        if path == "/api/settings":
            with db_lock:
                data = load_db()
                settings = dict(data.get("hotel_settings", DEFAULT_SETTINGS))
            if PUBLIC_URL.startswith(("http://", "https://")):
                settings["public_url"] = PUBLIC_URL
            self.send_json(200, settings)
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

        if path == "/api/media/current":
            room = normalize_digits((qs.get("room") or [""])[0])
            pin = normalize_digits((qs.get("pin") or [""])[0])
            if not verify_room_pin_db(room, pin):
                self.send_json(403, {"active": False, "media": None})
                return
            with media_lock:
                entry = media_cast_state.get(room)
                meta = public_media_meta(entry, pin) if entry and os.path.exists(entry.get("path", "")) else None
            self.send_json(200, {"active": bool(meta), "media": meta})
            return

        if path == "/api/media/file":
            self.serve_media_file(qs, head_only=False)
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
            channel = str(body.get("channel") or "").strip()
            payload = body.get("payload")
            if not channel or not isinstance(payload, dict):
                self.send_json(400, {"error": {"message": "Invalid RTC payload"}})
                return
            seq = push_rtc_signal(channel, payload)
            self.send_json(200, {"ok": True, "seq": seq})
            return

        if path == "/api/media/control":
            room = normalize_digits(body.get("room"))
            pin = normalize_digits(body.get("pin"))
            action = str(body.get("action") or "").strip().lower()
            if not verify_room_pin_db(room, pin):
                self.send_json(403, {"error": {"message": "رمز الغرفة غير صحيح"}})
                return
            if action == "stop":
                clear_room_media(room, notify_pin=pin)
                self.send_json(200, {"ok": True, "active": False})
                return
            with media_lock:
                entry = media_cast_state.get(room)
                if not entry:
                    self.send_json(200, {"ok": True, "active": False})
                    return
                if action == "pause":
                    entry["paused"] = True
                elif action == "play":
                    entry["paused"] = False
                elif action == "mute":
                    entry["muted"] = True
                elif action == "unmute":
                    entry["muted"] = False
                meta = public_media_meta(entry, pin)
            push_rtc_signal(f"tvip-cast-{room}-{pin}", {"type": "media-control", "action": action, "media": meta})
            self.send_json(200, {"ok": True, "active": True, "media": meta})
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
                old_pin = str((data["guests"].get(room) or {}).get("cast_pin") or "")
                row = {
                    "room_number": room,
                    "full_name": full_name,
                    "cast_pin": gen_pin(),
                    "preferred_lang": lang,
                }
                data["guests"][room] = row
                save_db(data)
            clear_room_media(room, notify_pin=old_pin)
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
                old_pin = str(old.get("cast_pin") or "")
                row = {
                    "room_number": room,
                    "full_name": "",
                    "cast_pin": gen_pin(),
                    "preferred_lang": old.get("preferred_lang", "ar"),
                }
                data["guests"][room] = row
                save_db(data)
            clear_room_media(room, notify_pin=old_pin)
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

        if path == "/api/media/current":
            room = normalize_digits((qs.get("room") or [""])[0])
            pin = normalize_digits((qs.get("pin") or [""])[0])
            if not verify_room_pin_db(room, pin):
                self.send_json(403, {"active": False, "media": None})
                return
            with media_lock:
                entry = media_cast_state.get(room)
                meta = public_media_meta(entry, pin) if entry and os.path.exists(entry.get("path", "")) else None
            self.send_json(200, {"active": bool(meta), "media": meta})
            return

        if path == "/api/media/file":
            self.serve_media_file(qs, head_only=False)
            return

        self.send_json(404, {"error": {"message": "Endpoint not found"}})


def main():
    global PUBLIC_URL
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    bind_host = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"
    if len(sys.argv) > 3 and sys.argv[3].strip():
        PUBLIC_URL = sys.argv[3].strip().rstrip("/")

    def shutdown_handler(_sig, _frame):
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    server = http.server.ThreadingHTTPServer((bind_host, port), HotelRequestHandler)
    print(f"Masaken Al-Nuzha Local Server running on http://{bind_host}:{port}/", flush=True)
    if PUBLIC_URL:
        print(f"Configured public guest URL: {PUBLIC_URL}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
