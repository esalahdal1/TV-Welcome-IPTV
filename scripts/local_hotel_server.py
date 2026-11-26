#!/usr/bin/env python3
"""Local Office & Hotel Backend Server for Masaken Al-Nuzha TVIP.

Serves static web assets alongside a persistent JSON REST API (/api/*)
for rooms, PIN pairing/rotation, room service requests, TV notifications,
hotel settings, staff authentication, and local WebRTC signaling.
"""

import hashlib
import http.server
import json
import math
import os
import random
import re
import signal
import socket
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPTS_DIR, "local_hotel_db.json")
WIDGETS_CACHE_PATH = os.path.join(SCRIPTS_DIR, "widgets_cache.json")
CACHED_M3U_PATH = os.path.join(SCRIPTS_DIR, "cached_channels.m3u")
CHANNEL1_DIR = os.path.join(SCRIPTS_DIR, "channel1_media")
APK_DIR = os.path.join(SCRIPTS_DIR, "apk_dist")
APK_FILE_PATH = os.path.join(APK_DIR, "masaken.apk")
MEDIA_DIR = os.path.join(tempfile.gettempdir(), "tvip_cast_media")
os.makedirs(MEDIA_DIR, exist_ok=True)
os.makedirs(CHANNEL1_DIR, exist_ok=True)
os.makedirs(APK_DIR, exist_ok=True)

SERVICE_SIGNATURE = "masaken-tvip"
DISCOVERY_UDP_PORT = 8898
ONLINE_TTL_SEC = 45
ALLOWED_TV_COMMANDS = {"reload", "open_tv", "open_portal", "stop_cast", "update_apk"}
DEFAULT_UPSTREAM_M3U = ""

DEFAULT_HOTEL_CHANNELS = [
    # 1. القنوات الدينية (مكة والمدينة)
    {
        "id": "sa_quran",
        "name": "قناة القرآن الكريم — مكة المكرمة",
        "group": "القنوات الدينية",
        "url": "http://m.live.net.sa:1935/live/quran/gmswf.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_sunnah",
        "name": "قناة السنة النبوية — المدينة المنورة",
        "group": "القنوات الدينية",
        "url": "http://m.live.net.sa:1935/live/sunnah/gmswf.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_quran_radio",
        "name": "إذاعة القرآن الكريم المرئية — السعودية",
        "group": "القنوات الدينية",
        "url": "https://live.kwikmotion.com/sbrksaquranradiolive/srpksaquranradio/playlist.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_iqraa_quran",
        "name": "قناة اقرأ للقرآن الكريم",
        "group": "القنوات الدينية",
        "url": "https://playlist.fasttvcdn.com/pl/dlkqw1ftuvuuzkcb4pxdcg/Iqraafasttv2/playlist.m3u8",
        "enabled": True,
    },
    # 2. القنوات السعودية الرسمية
    {
        "id": "sa_saudiya",
        "name": "القناة السعودية",
        "group": "القنوات السعودية",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-saudi-tv/2ad66056b51fd8c1b624854623112e43/index.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_sbc",
        "name": "قناة SBC السعودية",
        "group": "القنوات السعودية",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-sbc/90e09c0c28db26435799b4a14892a167/index.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_alaan",
        "name": "السعودية الآن",
        "group": "القنوات السعودية",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-ksa-now/71ed3aa814c643306c0a8bc4fcc7d17f/index.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_thikrayat",
        "name": "قناة ذكريات السعودية",
        "group": "القنوات السعودية",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-thikrayat/8cfa8fe0c96275735745b89c683b27e3/index.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_thaqafiya",
        "name": "القناة الثقافية السعودية",
        "group": "القنوات السعودية",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-thaqafeyyah/28c0d2a20dbf1dc049ce15d3973f494b/index.m3u8",
        "enabled": True,
    },
    # 3. القنوات الإخبارية والاقتصادية
    {
        "id": "sa_ekhbariya",
        "name": "قناة الإخبارية السعودية",
        "group": "الأخبار",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-al-ekhbaria/297b3ef1cd0633ad9cfba7473a686a06/index.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_hadath",
        "name": "قناة الحدث",
        "group": "الأخبار",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-hadath/2ff87ec4c2f3ede35295a20637d9f8fd/index.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_asharq",
        "name": "قناة الشرق للأخبار",
        "group": "الأخبار",
        "url": "https://live-news.asharq.com/asharq.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_alarabiya_biz",
        "name": "العربية بزنس",
        "group": "الأخبار",
        "url": "https://live.alarabiya.net/alarabiapublish/aswaaq.smil/playlist.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_aljazeera",
        "name": "قناة الجزيرة",
        "group": "الأخبار",
        "url": "https://live-hls-apps-aja-fa.getaj.net/AJA/01.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_aljazeera_mubasher",
        "name": "الجزيرة مباشر",
        "group": "الأخبار",
        "url": "https://live-hls-apps-ajm-fa.getaj.net/AJM/index.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_skynews",
        "name": "سكاي نيوز عربية",
        "group": "الأخبار",
        "url": "https://live-stream.skynewsarabia.com/c-horizontal-channel/horizontal-stream/index.m3u8",
        "enabled": True,
    },
    # 4. ترفيه وعائلة
    {
        "id": "ar_mbc1",
        "name": "MBC 1",
        "group": "ترفيه وعائلة",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-1/15cf99af5de54063fdabfefe66adc075/index.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_mbc_drama",
        "name": "MBC دراما",
        "group": "ترفيه وعائلة",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-drama/2c28a458e2f3253e678b07ac7d13fe71/index.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_mbc_masr",
        "name": "MBC مصر",
        "group": "ترفيه وعائلة",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-masr/956eac069c78a35d47245db6cdbb1575/index.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_mbc4",
        "name": "MBC 4",
        "group": "ترفيه وعائلة",
        "url": "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-4/24f134f1cd63db9346439e96b86ca6ed/index.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_rotana_cinema",
        "name": "روتانا سينما السعودية",
        "group": "ترفيه وعائلة",
        "url": "https://r.eu.cdn-redge.media/livehls/oeu/mt/live/rotana_cinema/live.livx/playlist.m3u8",
        "enabled": True,
    },
    {
        "id": "sa_rotana_classic",
        "name": "روتانا كلاسيك",
        "group": "ترفيه وعائلة",
        "url": "https://r.eu.cdn-redge.media/livehls/oeu/mt/live/rotana_classic/live.livx/playlist.m3u8",
        "enabled": True,
    },
    # 5. وثائقية ومعرفية
    {
        "id": "ar_asharq_doc",
        "name": "الشرق الوثائقية",
        "group": "وثائقية",
        "url": "https://svs.itworkscdn.net/asharqdocumentarylive/asharqdocumentary.smil/playlist_dvr.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_asharq_disc",
        "name": "الشرق ديسكفري",
        "group": "وثائقية",
        "url": "https://svs.itworkscdn.net/asharqdiscoverylive/asharqd.smil/playlist_dvr.m3u8",
        "enabled": True,
    },
    {
        "id": "ar_aj_doc",
        "name": "الجزيرة الوثائقية",
        "group": "وثائقية",
        "url": "https://live-hls-apps-ajd-fa.getaj.net/AJD/index.m3u8",
        "enabled": True,
    },
]
DEFAULT_SETTINGS = {
    "wifi_name": "Masaken_Guest",
    "wifi_pass": "Masaken@2026",
    "reception_ext": "0 / 100",
    "breakfast_hours": "07:00 - 10:30",
    "checkout_time": "14:00",
    "iptv_m3u_url": "",
}

BLOCKED_PREFIXES = (
    ".git/",
    "mvp/",
    "scripts/local_hotel_db.json",
    "scripts/widgets_cache.json",
    "scripts/channel1_media/",
    "scripts/apk_dist/",
)
PUBLIC_URL = str(os.environ.get("TVIP_PUBLIC_URL") or "").strip().rstrip("/")
MAX_MEDIA_BYTES = 150 * 1024 * 1024
MAX_CHANNEL1_BYTES = 500 * 1024 * 1024
MAX_APK_BYTES = 150 * 1024 * 1024
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
widgets_lock = threading.Lock()
tv_screens_lock = threading.Lock()
tv_screens = {}
tv_commands = {}
RIYADH_TZ = timezone(timedelta(hours=3))


def copy_default_channels() -> list:
    return [dict(ch) for ch in DEFAULT_HOTEL_CHANNELS]


def riyadh_today():
    now = datetime.now(RIYADH_TZ)
    return now.year, now.month, now.day, now.strftime("%Y-%m-%d")


def compute_jeddah_prayers(y: int, m: int, d: int, lat: float = 21.5433, lon: float = 39.1728, tz: float = 3.0) -> dict:
    """Compute Jeddah Umm al-Qura prayer timings offline as an exact local fallback."""
    yy, mm = y, m
    if mm <= 2:
        yy -= 1
        mm += 12
    a_term = yy // 100
    b_term = 2 - a_term + a_term // 4
    jd = int(365.25 * (yy + 4716)) + int(30.6001 * (mm + 1)) + d + b_term - 1524.5
    d_ep = jd - 2451545.0
    g = math.radians((357.529 + 0.98560028 * d_ep) % 360.0)
    q = (280.459 + 0.98564736 * d_ep) % 360.0
    l_sun = math.radians((q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360.0)
    e = math.radians(23.439 - 0.00000036 * d_ep)
    ra = (math.degrees(math.atan2(math.cos(e) * math.sin(l_sun), math.cos(l_sun))) / 15.0) % 24.0
    eqt = q / 15.0 - ra
    if eqt > 12:
        eqt -= 24.0
    elif eqt < -12:
        eqt += 24.0
    decl = math.asin(math.sin(e) * math.sin(l_sun))
    lat_r = math.radians(lat)
    dhuhr = 12.0 + tz - lon / 15.0 - eqt

    def ha(angle_deg: float) -> float:
        val = (-math.sin(math.radians(angle_deg)) - math.sin(lat_r) * math.sin(decl)) / (
            math.cos(lat_r) * math.cos(decl)
        )
        val = max(-1.0, min(1.0, val))
        return math.degrees(math.acos(val)) / 15.0

    fajr = dhuhr - ha(18.5)
    asr_alt = math.degrees(math.atan(1.0 / (1.0 + math.tan(abs(lat_r - decl)))))
    asr = dhuhr + ha(-asr_alt)
    maghrib = dhuhr + ha(0.8333)
    isha = maghrib + 1.5

    def fmt(hours: float) -> str:
        tot = int(round(hours * 60)) % 1440
        return f"{tot // 60:02d}:{tot % 60:02d}"

    return {
        "Fajr": fmt(fajr),
        "Dhuhr": fmt(dhuhr),
        "Asr": fmt(asr),
        "Maghrib": fmt(maghrib),
        "Isha": fmt(isha),
    }


_widgets_mem_cache = None
_widgets_mem_mtime = 0.0


def load_widgets_cache() -> dict:
    global _widgets_mem_cache, _widgets_mem_mtime
    if not os.path.exists(WIDGETS_CACHE_PATH):
        return {"prayers_by_date": {}, "weather": None, "m3u_synced_at": 0}
    try:
        mt = os.path.getmtime(WIDGETS_CACHE_PATH)
        if _widgets_mem_cache is not None and mt == _widgets_mem_mtime:
            return _widgets_mem_cache
        with open(WIDGETS_CACHE_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raise ValueError("invalid widgets cache")
        raw.setdefault("prayers_by_date", {})
        raw.setdefault("weather", None)
        raw.setdefault("m3u_synced_at", 0)
        _widgets_mem_cache = raw
        _widgets_mem_mtime = mt
        return raw
    except Exception:
        return {"prayers_by_date": {}, "weather": None, "m3u_synced_at": 0}


def save_widgets_cache(cache: dict) -> None:
    global _widgets_mem_cache, _widgets_mem_mtime
    tmp = WIDGETS_CACHE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    os.replace(tmp, WIDGETS_CACHE_PATH)
    _widgets_mem_cache = cache
    try:
        _widgets_mem_mtime = os.path.getmtime(WIDGETS_CACHE_PATH)
    except OSError:
        pass


def http_fetch_bytes(url: str, timeout: int = 8) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "MasakenHotelServer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def sync_server_caches_once(force_m3u: bool = False) -> None:
    """Refresh server-cached prayer calendar, weather, and IPTV M3U when internet is reachable."""
    y, m, _d, today_str = riyadh_today()
    with widgets_lock:
        cache = load_widgets_cache()

    prayers_map = cache.get("prayers_by_date") or {}
    # Prune stale prayer dates older than 3 days before syncing
    cutoff = (datetime.now(RIYADH_TZ) - timedelta(days=3)).strftime("%Y-%m-%d")
    prayers_map = {k: v for k, v in prayers_map.items() if k >= cutoff}
    need_next_month = (datetime.now(RIYADH_TZ) + timedelta(days=7)).month != m
    if today_str not in prayers_map or len(prayers_map) < 15 or need_next_month:
        months = [(y, m)]
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        months.append((ny, nm))
        for (yy, mm) in months:
            try:
                url = (
                    f"https://api.aladhan.com/v1/calendarByCity/{yy}/{mm}"
                    "?city=Jeddah&country=Saudi%20Arabia&method=4"
                )
                doc = json.loads(http_fetch_bytes(url, timeout=8).decode("utf-8"))
                for item in doc.get("data") or []:
                    g_date = ((item.get("date") or {}).get("gregorian") or {}).get("date") or ""
                    timings = item.get("timings") or {}
                    if "-" in g_date and len(g_date.split("-")) == 3:
                        dd_s, mm_s, yy_s = g_date.split("-")
                        iso_d = f"{yy_s}-{mm_s.zfill(2)}-{dd_s.zfill(2)}"
                        if iso_d >= cutoff and timings:
                            prayers_map[iso_d] = {
                                k: str(timings.get(k, "")).split(" ")[0]
                                for k in ("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha")
                                if timings.get(k)
                            }
            except Exception:
                pass
        cache["prayers_by_date"] = prayers_map

    try:
        w_url = (
            "https://api.open-meteo.com/v1/forecast?latitude=21.5433&longitude=39.1728"
            "&current=temperature_2m,weather_code&timezone=Asia%2FRiyadh"
        )
        w_doc = json.loads(http_fetch_bytes(w_url, timeout=6).decode("utf-8"))
        cur_w = w_doc.get("current") or {}
        if cur_w.get("temperature_2m") is not None:
            cache["weather"] = {
                "temperature_2m": cur_w.get("temperature_2m"),
                "weather_code": cur_w.get("weather_code"),
                "updated_at": now_iso(),
            }
    except Exception:
        pass

    with db_lock:
        db_data = load_db()
        custom_m3u = str((db_data.get("hotel_settings") or {}).get("iptv_m3u_url") or "").strip()
    target_m3u = custom_m3u
    now_ts = time.time()
    last_m3u_sync = float(cache.get("m3u_synced_at") or 0)
    last_m3u_url = str(cache.get("m3u_source_url") or "")
    if not target_m3u:
        if os.path.exists(CACHED_M3U_PATH):
            try:
                os.unlink(CACHED_M3U_PATH)
            except OSError:
                pass
        cache["m3u_source_url"] = ""
    elif (
        force_m3u
        or not os.path.exists(CACHED_M3U_PATH)
        or target_m3u != last_m3u_url
        or (now_ts - last_m3u_sync) > 6 * 3600
    ):
        try:
            raw_m3u = http_fetch_bytes(target_m3u, timeout=15).decode("utf-8", errors="ignore")
            if "#EXTINF" in raw_m3u or "#EXTM3U" in raw_m3u:
                tmp_m3u = CACHED_M3U_PATH + ".tmp"
                with open(tmp_m3u, "w", encoding="utf-8") as mf:
                    mf.write(raw_m3u)
                os.replace(tmp_m3u, CACHED_M3U_PATH)
                cache["m3u_synced_at"] = now_ts
                cache["m3u_source_url"] = target_m3u
        except Exception:
            pass

    with widgets_lock:
        save_widgets_cache(cache)


def start_cache_sync_worker() -> None:
    def worker():
        while True:
            try:
                sync_server_caches_once(force_m3u=False)
            except Exception:
                pass
            time.sleep(1800)

    t = threading.Thread(target=worker, daemon=True)
    t.start()


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def gen_pin(exclude: str = "") -> str:
    clean_ex = str(exclude or "").strip()
    for _ in range(20):
        cand = str(random.randint(1000, 9999))
        if cand != clean_ex:
            return cand
    return str(random.randint(1000, 9999))


def get_apk_info_payload(data: dict = None) -> dict:
    if not os.path.exists(APK_FILE_PATH):
        return {"ok": True, "available": False, "size": 0, "updated_at": None, "url": "/masaken.apk"}
    size = os.path.getsize(APK_FILE_PATH)
    mtime_iso = datetime.fromtimestamp(os.path.getmtime(APK_FILE_PATH), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = (data or {}).get("apk_info") or {}
    return {
        "ok": True,
        "available": size > 0,
        "size": size,
        "filename": meta.get("filename") or "masaken.apk",
        "updated_at": meta.get("updated_at") or mtime_iso,
        "url": "/masaken.apk",
    }


def start_udp_discovery_responder(http_port: int, udp_port: int = DISCOVERY_UDP_PORT) -> None:
    """Reply to LAN UDP broadcast probes so TVs auto-discover server IP changes instantly."""
    def responder():
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", udp_port))
        except Exception as exc:
            print(f"UDP discovery bind skipped on port {udp_port}: {exc}", flush=True)
            return
        while True:
            try:
                raw, addr = sock.recvfrom(1024)
                msg = raw.decode("utf-8", errors="ignore").strip()
                if msg.startswith("MASAKEN_DISCOVER"):
                    reply = json.dumps(
                        {
                            "service": SERVICE_SIGNATURE,
                            "http_port": 80,
                            "direct_port": http_port,
                            "hostname": socket.gethostname(),
                        }
                    ).encode("utf-8")
                    sock.sendto(reply, addr)
            except Exception:
                time.sleep(0.2)

    threading.Thread(target=responder, daemon=True).start()


def default_db() -> dict:
    return {
        "staff_pin_hash": sha256_hex("1234"),
        "hotel_settings": dict(DEFAULT_SETTINGS),
        "guests": {},
        "requests": [],
        "notifications": [],
        "iptv_channels": copy_default_channels(),
        "screens_registry": {},
    }


_db_mem_cache = None
_db_mem_mtime = 0.0


def load_db() -> dict:
    global _db_mem_cache, _db_mem_mtime
    if not os.path.exists(DB_PATH):
        data = default_db()
        save_db(data)
        return data
    try:
        mt = os.path.getmtime(DB_PATH)
        if _db_mem_cache is not None and mt == _db_mem_mtime:
            return _db_mem_cache
        with open(DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("invalid db root")
        data.setdefault("staff_pin_hash", sha256_hex("1234"))
        data.setdefault("hotel_settings", dict(DEFAULT_SETTINGS))
        data.setdefault("guests", {})
        data.setdefault("requests", [])
        data.setdefault("notifications", [])
        changed = False
        if "iptv_channels" not in data or not isinstance(data.get("iptv_channels"), list):
            data["iptv_channels"] = copy_default_channels()
            changed = True
        if "screens_registry" not in data or not isinstance(data.get("screens_registry"), dict):
            data["screens_registry"] = {}
            changed = True
        if changed:
            save_db(data)
        else:
            _db_mem_cache = data
            _db_mem_mtime = mt
        return data
    except Exception:
        data = default_db()
        save_db(data)
        return data


def save_db(data: dict) -> None:
    global _db_mem_cache, _db_mem_mtime
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DB_PATH)
    _db_mem_cache = data
    try:
        _db_mem_mtime = os.path.getmtime(DB_PATH)
    except OSError:
        pass


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


def clear_room_media(room: str, notify_pin: str = "", full_reset: bool = False) -> None:
    """Remove active cast media for a room, purge orphan room files, and notify sessions."""
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
    prefix = f"room_{clean_room}_"
    try:
        for fname in os.listdir(MEDIA_DIR):
            if fname.startswith(prefix):
                fpath = os.path.join(MEDIA_DIR, fname)
                if os.path.isfile(fpath):
                    try:
                        os.unlink(fpath)
                    except OSError:
                        pass
    except OSError:
        pass
    if notify_pin:
        ch = f"tvip-cast-{clean_room}-{notify_pin}"
        push_rtc_signal(ch, {"type": "media-stop"})
        if full_reset:
            push_rtc_signal(ch, {"kind": "stop", "from": "tv"})
            push_rtc_signal(ch, {"type": "room-reset"})


class HotelRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        if args:
            first = str(args[0])
            if "/api/rtc/poll" in first or "/api/tv/heartbeat" in first:
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
        if parsed.path == "/api/channel1/video":
            self.serve_channel1_video(head_only=True)
            return
        if parsed.path in ("/masaken.apk", "/api/apk/download"):
            self.serve_apk_file(head_only=True)
            return
        if parsed.path == "/api/channels.m3u":
            self.serve_channels_m3u(head_only=True)
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
        if parsed.path == "/masaken.apk":
            self.serve_apk_file(head_only=False)
            return
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
        if parsed.path == "/api/staff/channel1/upload":
            self.handle_channel1_upload(urllib.parse.parse_qs(parsed.query))
            return
        if parsed.path == "/api/staff/apk/upload":
            self.handle_apk_upload(urllib.parse.parse_qs(parsed.query))
            return
        if not parsed.path.startswith("/api/"):
            self.send_error(405, "Method Not Allowed")
            return
        self.handle_api_post(parsed.path)

    def stream_file_with_range(self, file_path: str, mime: str, head_only: bool = False):
        """Serve a disk file with HTTP Accept-Ranges / 206 Partial Content support."""
        if not file_path or not os.path.exists(file_path):
            self.send_json(404, {"error": {"message": "الملف غير موجود"}})
            return
        file_size = os.path.getsize(file_path)
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
        self.send_header("Content-Type", mime or "application/octet-stream")
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
        self.stream_file_with_range(entry["path"], entry.get("mime") or "application/octet-stream", head_only=head_only)

    def serve_channel1_video(self, head_only: bool = False):
        """Serve the persistent Hotel Channel 1 promotional/welcome video."""
        with db_lock:
            data = load_db()
            ch1 = data.get("hotel_channel1")
        if not ch1 or not ch1.get("path") or not os.path.exists(ch1.get("path")):
            self.send_json(404, {"error": {"message": "لم يتم رفع فيديو القناة الأولى بعد"}})
            return
        self.stream_file_with_range(ch1["path"], ch1.get("mime") or "video/mp4", head_only=head_only)

    def serve_apk_file(self, head_only: bool = False):
        """Serve the locally hosted Masaken Android TV APK for LAN install & self-update."""
        if not os.path.exists(APK_FILE_PATH):
            self.send_json(404, {"error": {"message": "لا توجد نسخة APK مرفوعة على السيرفر بعد"}})
            return
        self.stream_file_with_range(APK_FILE_PATH, "application/vnd.android.package-archive", head_only=head_only)

    def handle_apk_upload(self, qs: dict):
        """Allow hotel admin to upload/replace the local Android TV APK (/masaken.apk)."""
        pin = normalize_digits((qs.get("pin") or [""])[0])
        with db_lock:
            data = load_db()
            if not self.verify_staff(data, pin):
                self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                return

        length, ok = self.read_binary_upload(MAX_APK_BYTES)
        if not ok:
            return
        raw_name = urllib.parse.unquote((qs.get("name") or ["masaken.apk"])[0]).strip()
        filename = os.path.basename(raw_name)[:80] or "masaken.apk"
        if not filename.lower().endswith(".apk"):
            self.send_json(415, {"error": {"message": "يرجى رفع ملف بصيغة .apk صالحة"}})
            return

        tmp_path = APK_FILE_PATH + ".tmp"
        if not self.write_request_body_to_file(tmp_path, length):
            return
        os.replace(tmp_path, APK_FILE_PATH)

        with db_lock:
            data = load_db()
            data["apk_info"] = {
                "filename": filename,
                "size": length,
                "updated_at": now_iso(),
            }
            save_db(data)
            payload = get_apk_info_payload(data)
        self.send_json(200, payload)

    def serve_channels_m3u(self, head_only: bool = False):
        """Build #EXTM3U playlist placing Hotel Channel #1 first, then curated Saudi/Arabic channels."""
        host = (self.headers.get("Host") or "127.0.0.1:8899").strip()
        proto = (self.headers.get("X-Forwarded-Proto") or "http").split(",")[0].strip()
        base = f"{proto}://{host}"
        with db_lock:
            data = load_db()
            ch1 = data.get("hotel_channel1")
            curated = list(data.get("iptv_channels") or [])
            custom_m3u = str((data.get("hotel_settings") or {}).get("iptv_m3u_url") or "").strip()

        lines = ["#EXTM3U"]
        if ch1 and ch1.get("path") and os.path.exists(ch1.get("path")):
            title = str(ch1.get("title") or "مساكن النزهة — القناة الترحيبية").replace("\n", " ").replace("\r", " ").strip()
            ver = int(ch1.get("version") or 1)
            lines.append(f'#EXTINF:-1 tvg-id="masaken-ch1" group-title="الفندق",{title}')
            lines.append(f"{base}/api/channel1/video?v={ver}")

        for idx, item in enumerate(curated):
            if not isinstance(item, dict) or not item.get("enabled", True):
                continue
            name = str(item.get("name") or "").replace("\n", " ").replace("\r", " ").strip()
            url = str(item.get("url") or "").strip()
            group = str(item.get("group") or "قنوات عربية").replace('"', "").replace("\n", " ").strip()
            cid = str(item.get("id") or f"ch_{idx + 2}").replace('"', "").strip()
            if not name or not url:
                continue
            full_url = f"{base}{url}" if url.startswith("/") else url
            lines.append(f'#EXTINF:-1 tvg-id="{cid}" group-title="{group}",{name}')
            lines.append(full_url)

        if custom_m3u and os.path.exists(CACHED_M3U_PATH):
            try:
                with open(CACHED_M3U_PATH, "r", encoding="utf-8", errors="ignore") as f:
                    for raw_line in f:
                        s = raw_line.rstrip("\r\n")
                        if not s or s.strip().upper().startswith("#EXTM3U"):
                            continue
                        lines.append(s)
            except OSError:
                pass

        raw = ("\n".join(lines) + "\n").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "audio/x-mpegurl; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if not head_only:
            self.wfile.write(raw)

    def read_binary_upload(self, max_bytes: int):
        """Validate Content-Length and return (length, ok) or send an error response."""
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > max_bytes:
            mb = max_bytes // (1024 * 1024)
            self.send_json(400, {"error": {"message": f"حجم الملف غير مسموح (الحد الأقصى {mb} ميجابايت)"}})
            return 0, False
        return length, True

    def write_request_body_to_file(self, dest_path: str, length: int) -> bool:
        """Stream exactly length bytes from self.rfile to dest_path."""
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
                return False
            return True
        except Exception:
            try:
                if os.path.exists(dest_path):
                    os.unlink(dest_path)
            except OSError:
                pass
            self.send_json(500, {"error": {"message": "تعذر حفظ الملف على السيرفر"}})
            return False

    def handle_channel1_upload(self, qs: dict):
        """Upload persistent Hotel Welcome Video locked permanently as Channel #1."""
        pin = normalize_digits((qs.get("pin") or [""])[0])
        with db_lock:
            data = load_db()
            if not self.verify_staff(data, pin):
                self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                return

        length, ok = self.read_binary_upload(MAX_CHANNEL1_BYTES)
        if not ok:
            return

        raw_name = urllib.parse.unquote((qs.get("name") or [self.headers.get("X-File-Name") or "welcome.mp4"])[0]).strip()
        filename = os.path.basename(raw_name)[:80] or "welcome.mp4"
        title = urllib.parse.unquote((qs.get("title") or ["مساكن النزهة — القناة الترحيبية"])[0]).strip()[:80]
        if not title:
            title = "مساكن النزهة — القناة الترحيبية"
        raw_ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        ext = os.path.splitext(filename)[1].lower()
        if raw_ct in ALLOWED_MEDIA_MIME and ALLOWED_MEDIA_MIME[raw_ct][0] == "video":
            suffix = ALLOWED_MEDIA_MIME[raw_ct][1]
            mime = raw_ct
        elif ext in ALLOWED_EXT_TO_MIME and ALLOWED_EXT_TO_MIME[ext][0] == "video":
            suffix = ext
            mime = ALLOWED_EXT_TO_MIME[ext][1]
        else:
            self.send_json(415, {"error": {"message": "يرجى اختيار ملف فيديو صالح للقناة (MP4 / MOV / WebM)"}})
            return

        tok = uuid.uuid4().hex[:12]
        dest_path = os.path.join(CHANNEL1_DIR, f"channel1_{tok}{suffix}")
        if not self.write_request_body_to_file(dest_path, length):
            return

        with db_lock:
            data = load_db()
            prev = data.get("hotel_channel1") or {}
            ver = int(prev.get("version") or 0) + 1
            entry = {
                "title": title,
                "group": "الفندق",
                "filename": filename,
                "mime": mime,
                "size": length,
                "version": ver,
                "path": dest_path,
                "updated_at": now_iso(),
            }
            data["hotel_channel1"] = entry
            save_db(data)

        old_path = prev.get("path")
        if old_path and old_path != dest_path:
            try:
                if os.path.exists(old_path):
                    os.unlink(old_path)
            except OSError:
                pass

        info = {k: v for k, v in entry.items() if k != "path"}
        info["url"] = f"/api/channel1/video?v={ver}"
        self.send_json(200, {"ok": True, "active": True, "channel": info})

    def handle_media_upload(self, qs: dict):
        """Stream an uploaded photo or video from a verified room guest to temp storage."""
        global media_seq
        room = normalize_digits((qs.get("room") or [""])[0])
        pin = normalize_digits((qs.get("pin") or [""])[0])
        if not verify_room_pin_db(room, pin):
            self.send_json(403, {"error": {"message": "رمز الغرفة غير صحيح أو انتهت الجلسة"}})
            return

        length, ok = self.read_binary_upload(MAX_MEDIA_BYTES)
        if not ok:
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
        if not self.write_request_body_to_file(dest_path, length):
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
                "size": length,
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
        if path in ("/api/health", "/api/discover"):
            self.send_json(
                200,
                {
                    "ok": True,
                    "service": SERVICE_SIGNATURE,
                    "hostname": socket.gethostname(),
                    "mode": "local",
                    "apk_available": os.path.exists(APK_FILE_PATH),
                    "apk_url": "/masaken.apk",
                    "time": now_iso(),
                },
            )
            return

        if path == "/api/apk/info":
            with db_lock:
                data = load_db()
                payload = get_apk_info_payload(data)
            self.send_json(200, payload)
            return

        if path == "/api/apk/download":
            self.serve_apk_file(head_only=False)
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

        if path == "/api/widgets":
            y, m, d, today_str = riyadh_today()
            with widgets_lock:
                cache = load_widgets_cache()
            p_map = cache.get("prayers_by_date") or {}
            cached_today = p_map.get(today_str)
            if cached_today and all(k in cached_today for k in ("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha")):
                prayers = cached_today
                prayers_source = "aladhan_cache"
            else:
                prayers = compute_jeddah_prayers(y, m, d)
                prayers_source = "umm_alqura_math"
            self.send_json(
                200,
                {
                    "date": today_str,
                    "prayers": prayers,
                    "prayers_source": prayers_source,
                    "weather": cache.get("weather"),
                },
            )
            return

        if path == "/api/channel1/info":
            with db_lock:
                data = load_db()
                ch1 = data.get("hotel_channel1")
            if not ch1 or not ch1.get("path") or not os.path.exists(ch1.get("path")):
                self.send_json(200, {"active": False, "channel": None})
                return
            info = {k: v for k, v in ch1.items() if k != "path"}
            info["url"] = f"/api/channel1/video?v={int(ch1.get('version') or 1)}"
            self.send_json(200, {"active": True, "channel": info})
            return

        if path == "/api/channel1/video":
            self.serve_channel1_video(head_only=False)
            return

        if path == "/api/channels.m3u":
            self.serve_channels_m3u(head_only=False)
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
                    "cast_pin": gen_pin(old_pin),
                    "preferred_lang": lang,
                }
                data["guests"][room] = row
                save_db(data)
            clear_room_media(room, notify_pin=old_pin, full_reset=True)
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
                    "cast_pin": gen_pin(old_pin),
                    "preferred_lang": old.get("preferred_lang", "ar"),
                }
                data["guests"][room] = row
                save_db(data)
            clear_room_media(room, notify_pin=old_pin, full_reset=True)
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
                    if k not in settings:
                        continue
                    val = str(settings.get(k) or "").strip()
                    if k == "iptv_m3u_url":
                        cur[k] = val
                    elif val:
                        cur[k] = val
                save_db(data)
            if "iptv_m3u_url" in settings:
                threading.Thread(target=sync_server_caches_once, kwargs={"force_m3u": True}, daemon=True).start()
            self.send_json(200, {"error": None})
            return

        if path == "/api/staff/channel1/meta":
            pin = normalize_digits(body.get("pin"))
            title = str(body.get("title") or "").strip()[:80]
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                ch1 = data.get("hotel_channel1")
                if not ch1 or not ch1.get("path") or not os.path.exists(ch1.get("path")):
                    self.send_json(404, {"error": {"message": "لا يوجد فيديو مثبّت حالياً"}})
                    return
                if title:
                    ch1["title"] = title
                    ch1["updated_at"] = now_iso()
                    save_db(data)
                info = {k: v for k, v in ch1.items() if k != "path"}
                info["url"] = f"/api/channel1/video?v={int(ch1.get('version') or 1)}"
            self.send_json(200, {"ok": True, "active": True, "channel": info})
            return

        if path == "/api/staff/channel1/delete":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                prev = data.pop("hotel_channel1", None)
                save_db(data)
            if prev and prev.get("path") and os.path.exists(prev.get("path")):
                try:
                    os.unlink(prev["path"])
                except OSError:
                    pass
            self.send_json(200, {"ok": True, "active": False, "channel": None})
            return

        if path == "/api/tv/heartbeat":
            room = normalize_digits(body.get("room"))
            mode = "lobby" if str(body.get("mode") or "").strip().lower() == "lobby" else "room"
            screen_state = str(body.get("screen_state") or "portal").strip()[:32]
            app_version = str(body.get("app_version") or "web").strip()[:24]
            platform = str(body.get("platform") or "web").strip()[:24]
            dev_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("device_id") or ""))[:32]
            reported_ip = str(body.get("local_ip") or "").strip()[:45]
            fwd_ip = (self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            client_ip = reported_ip or (fwd_ip if fwd_ip and fwd_ip != "127.0.0.1" else self.client_address[0])

            if platform == "simulator":
                screen_id = "sim-lobby" if mode == "lobby" else f"sim-{room or dev_id}"
            elif mode == "lobby":
                screen_id = f"lobby-{dev_id or client_ip}"
            elif room:
                screen_id = f"room-{room}"
            else:
                screen_id = f"unassigned-{dev_id or client_ip}"

            now_ts = time.time()
            now_str = now_iso()
            persist_needed = False
            with tv_screens_lock:
                prev = tv_screens.get(screen_id) or {}
                # Never allow a non-Android web preview to overwrite a registered physical Android TV
                if prev.get("platform") == "android_tv" and platform != "android_tv":
                    self.send_json(200, {"ok": True, "screen_id": screen_id, "commands": []})
                    return
                last_saved = float(prev.get("_saved_ts") or 0)
                if platform != "simulator" and (not prev or prev.get("ip") != client_ip or prev.get("app_version") != app_version or (now_ts - last_saved) > 60):
                    persist_needed = True
                    last_saved = now_ts
                rec = {
                    "screen_id": screen_id,
                    "room": room if mode == "room" else "",
                    "mode": mode,
                    "screen_state": screen_state,
                    "app_version": app_version,
                    "platform": platform,
                    "ip": client_ip,
                    "last_seen": now_str,
                    "last_seen_ts": now_ts,
                    "_saved_ts": last_saved,
                }
                tv_screens[screen_id] = rec
                cmds = tv_commands.pop(screen_id, [])

            if persist_needed:
                with db_lock:
                    data = load_db()
                    reg = data.setdefault("screens_registry", {})
                    reg[screen_id] = {k: v for k, v in rec.items() if not k.startswith("_")}
                    save_db(data)

            self.send_json(200, {"ok": True, "screen_id": screen_id, "commands": cmds})
            return

        if path == "/api/staff/channels/list":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                channels = list(data.get("iptv_channels") or [])
            self.send_json(200, {"ok": True, "channels": channels})
            return

        if path == "/api/staff/channels/save":
            pin = normalize_digits(body.get("pin"))
            raw_list = body.get("channels")
            if not isinstance(raw_list, list):
                self.send_json(400, {"error": {"message": "قائمة القنوات غير صالحة"}})
                return
            cleaned = []
            for idx, item in enumerate(raw_list[:200]):
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()[:80]
                url = str(item.get("url") or "").strip()[:500]
                group = str(item.get("group") or "قنوات عربية").strip()[:40] or "قنوات عربية"
                cid = re.sub(r"[^a-zA-Z0-9_-]", "", str(item.get("id") or ""))[:40] or f"ch_{uuid.uuid4().hex[:8]}"
                enabled = bool(item.get("enabled", True))
                if not name or not (url.startswith(("http://", "https://", "/"))):
                    continue
                cleaned.append({"id": cid, "name": name, "group": group, "url": url, "enabled": enabled})
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                data["iptv_channels"] = cleaned
                save_db(data)
            self.send_json(200, {"ok": True, "channels": cleaned})
            return

        if path == "/api/staff/channels/reset":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                fresh = copy_default_channels()
                data["iptv_channels"] = fresh
                save_db(data)
            self.send_json(200, {"ok": True, "channels": fresh})
            return

        if path == "/api/staff/screens":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                guests_map = dict(data.get("guests") or {})

            now_ts = time.time()
            with tv_screens_lock:
                snapshot = [dict(v) for v in tv_screens.values()]

            out = []
            online_cnt = 0
            for item in snapshot:
                last_ts = float(item.get("last_seen_ts") or 0)
                age = max(0, int(now_ts - last_ts)) if last_ts > 0 else 999999
                is_online = last_ts > 0 and age <= ONLINE_TTL_SEC
                if is_online:
                    online_cnt += 1
                rm = str(item.get("room") or "")
                g_row = guests_map.get(rm) or {}
                out.append(
                    {
                        "screen_id": item.get("screen_id"),
                        "room": rm,
                        "mode": item.get("mode") or "room",
                        "guest_name": str(g_row.get("full_name") or "").strip(),
                        "screen_state": item.get("screen_state") or "portal",
                        "app_version": item.get("app_version") or "—",
                        "platform": item.get("platform") or "web",
                        "ip": item.get("ip") or "—",
                        "last_seen": item.get("last_seen"),
                        "seconds_ago": age,
                        "online": is_online,
                    }
                )

            def sort_screen_key(s):
                if s["mode"] == "lobby":
                    return (1, 0, s["screen_id"])
                r = s["room"]
                return (0, int(r), "") if r.isdigit() else (2, 0, s["screen_id"])

            out.sort(key=sort_screen_key)
            self.send_json(200, {"ok": True, "screens": out, "online_count": online_cnt, "total_count": len(out)})
            return

        if path == "/api/staff/screens/command":
            pin = normalize_digits(body.get("pin"))
            target = str(body.get("target") or "").strip()
            command = str(body.get("command") or "").strip().lower()
            if command not in ALLOWED_TV_COMMANDS:
                self.send_json(400, {"error": {"message": "أمر التحكم غير صالح"}})
                return
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return

            queued = 0
            with tv_screens_lock:
                if target == "all":
                    targets = list(tv_screens.keys())
                elif target in tv_screens:
                    targets = [target]
                else:
                    clean_rm = normalize_digits(target)
                    targets = [f"room-{clean_rm}"] if clean_rm else []

                for sid in targets:
                    q = tv_commands.setdefault(sid, [])
                    if not any(c.get("command") == command for c in q):
                        q.append({"id": uuid.uuid4().hex[:8], "command": command, "ts": now_iso()})
                    if len(q) > 10:
                        del q[:-10]
                    queued += 1

            self.send_json(200, {"ok": True, "queued": queued, "command": command})
            return

        if path == "/api/staff/screens/remove":
            pin = normalize_digits(body.get("pin"))
            sid = str(body.get("screen_id") or "").strip()
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
                reg = data.get("screens_registry") or {}
                if sid in reg:
                    reg.pop(sid, None)
                    save_db(data)
            with tv_screens_lock:
                tv_screens.pop(sid, None)
                tv_commands.pop(sid, None)
            self.send_json(200, {"ok": True})
            return

        if path == "/api/staff/screens/clear-sim":
            pin = normalize_digits(body.get("pin"))
            with db_lock:
                data = load_db()
                if not self.verify_staff(data, pin):
                    self.send_json(401, {"error": {"message": "رمز الموظف غير صحيح"}})
                    return
            removed = 0
            with tv_screens_lock:
                sim_keys = [k for k, v in tv_screens.items() if k.startswith("sim-") or v.get("platform") == "simulator"]
                for k in sim_keys:
                    tv_screens.pop(k, None)
                    tv_commands.pop(k, None)
                    removed += 1
            self.send_json(200, {"ok": True, "removed": removed})
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


class HighConcurrencyHTTPServer(http.server.ThreadingHTTPServer):
    request_queue_size = 512
    daemon_threads = True
    allow_reuse_address = True


def main():
    global PUBLIC_URL
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    bind_host = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"
    if len(sys.argv) > 3 and sys.argv[3].strip():
        PUBLIC_URL = sys.argv[3].strip().rstrip("/")

    def shutdown_handler(_sig, _frame):
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    with db_lock:
        boot_db = load_db()
        saved_screens = dict(boot_db.get("screens_registry") or {})
    with tv_screens_lock:
        for sid, entry in saved_screens.items():
            if isinstance(entry, dict):
                tv_screens[sid] = dict(entry)
    start_cache_sync_worker()
    start_udp_discovery_responder(port)
    server = HighConcurrencyHTTPServer((bind_host, port), HotelRequestHandler)
    print(f"Masaken Al-Nuzha Local Server running on http://{bind_host}:{port}/", flush=True)
    if PUBLIC_URL:
        print(f"Configured public guest URL: {PUBLIC_URL}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
