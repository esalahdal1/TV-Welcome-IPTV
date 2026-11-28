# MAQAM TV (TVIP — مساكن النزهة) — AI Agent Blueprint

> **Public Repo Warning:** `esalahdal1/TV-Welcome-IPTV` is a **PUBLIC** GitHub repo. **NEVER** commit passwords, SSH keys, or keystore secrets here. Local credentials & deploy commands live exclusively in the gitignored file `.agents/rules/local-ops.md`.

## 1. What This Project Is
**MAQAM TV** (`مَقَام — مساكن النزهة`, Masaken Alrafahya Co., Jeddah) is a LAN-first Hotel TV, IPTV, Guest Portal, and Reception System built for **58 Room TVs + 9 Lobby Displays (67 screens)**:
- **Backend & Web Server (`scripts/local_hotel_server.py`)**: Multi-threaded Python server (`HighConcurrencyHTTPServer`, `request_queue_size=512`, RAM-cached JSON DB & widgets) running inside **Proxmox CT 102 (`masaken-tv`, `http://192.168.1.50`)** behind Nginx (`:80` -> `127.0.0.1:8899`, `client_max_body_size 520M`). Also answers LAN UDP broadcasts (`MASAKEN_DISCOVER_V1` on `:8898`) and hosts Channel #1 MP4 (`/api/channel1/video`) + Android APK (`/masaken.apk`). Tested for **100 concurrent TVs** (Burst 3.33s `800/800`, Sustained 240s `7662/7662`, `0` errors).
- **Web Front-End (`index.html`, `css/app.css`, `js/*.js`, `wall.html`)**: One unified HTML app switched by query params:
  - Room TV: `/?room=101` (Design #2 *Cinematic Hospitality Hero*: Obsidian `#07090E`, Gold `#E5C158`, Teal `#2DD4BF`, live scannable QR, 5 Jeddah prayer times, weather, 6-item remote dock).
  - Lobby Displays (`?mode=lobby`): auto-rotating 4-slide signage, `js/lobby.js`.
  - Mobile Guest Portal (`?guest=1&room=101&pin=XXXX`): PIN-gated room services, Wi-Fi copy, WebRTC screen share, and photo/video casting (`/api/media/upload`).
  - Staff/Admin Console (`?admin=1` or `?reception=1`): Rooms Check-in/out (auto-rotates 4-digit PIN), Live Screen Monitor + remote commands (`reload`, `open_tv`, `open_portal`, `stop_cast`, `update_apk`), Requests, Notifications, Channel #1 + 25 curated Saudi/Arabic channels, Hotel Settings, APK upload.
  - 10-TV Simulator Wall (`/wall.html`): runs virtual rooms `201..210` with `&sim=1` (`platform="simulator"` -> `sim-*` IDs, isolated from real Android TV `room-*` records).
- **Android TV Client (`android/`, label `MAQAM TV`, `v3.5`, `versionCode=20`, `applicationId="com.example.tv_guest_welcome"`)**: Fullscreen WebView + ExoPlayer IPTV player (`QuickPlayActivity` -> `PlayerActivity`, `ChannelsActivity`), hardware `Menu`/long-`Back` Technician Menu, `BootReceiver` + `ScreenService` auto-start, `TvMonitor` (12s native heartbeat + remote command execution), `ServerDiscovery` (UDP `:8898` + subnet sweep), offline emergency fallback (`assets/offline_welcome.html`), and OTA self-update from `/masaken.apk`.

## 2. Exact File Map (Read Directly — Do NOT Waste Tokens Running `ls -R`)
- **Web Core**: `index.html`, `css/app.css`, `wall.html`, `sw.js` (bump `?v=..` & `CACHE_NAME` when editing web files), `assets/maqam-emblem.svg`
- **Web Modules (`js/`)**:
  - `config.js`: URL flags (`room`, `pin`, `admin`, `reception`, `guest`, `mode=lobby`, `sim`, `tv`) + Supabase fallback constants
  - `i18n.js`: AR/EN strings & weather codes
  - `supabase-client.js`: Auto-detects local server (`/api/health`) first; falls back to Supabase
  - `widgets.js`: Clock (Riyadh TZ), Hijri/Gregorian date, Jeddah prayers (`/api/widgets` + Aladhan fallback), Open-Meteo weather
  - `portal.js`: Room TV lifecycle (10s guest sync, 14s web heartbeat, 20s notifications, D-Pad keys `◄ ► ▲ ▼ OK BACK`, live `#heroQrBox` QR, WebRTC/media stage)
  - `webrtc-cast.js`: WebRTC signaling over `/api/rtc/send` + `/api/rtc/poll` (requires HTTPS `trycloudflare.com` public URL for laptop `getDisplayMedia`)
  - `mobile-portal.js`, `lobby.js`, `staff.js`, `main.js`
- **Backend & Ops (`scripts/`)**:
  - `local_hotel_server.py`: Single-file HTTP/UDP server, DB (`local_hotel_db.json` gitignored), widgets cache (`widgets_cache.json`), Channel #1 media, screen registry (`ONLINE_TTL_SEC=45`)
  - `stress_test_100.py`: 100-TV burst + sustained load test (`--base http://192.168.1.50 --tvs 100 --duration 120`)
  - `provision_tv.sh` + `tv_fleet.csv.example`: Bulk ADB fleet setup
- **Android (`android/app/`)**:
  - `build.gradle.kts`, `src/main/AndroidManifest.xml`, `src/main/assets/offline_welcome.html`
  - Kotlin (`.../com/example/tv_guest_welcome/`): `MainActivity.kt`, `SetupActivity.kt`, `ChannelsActivity.kt`, `QuickPlayActivity.kt`, `PlayerActivity.kt`, `TvMonitor.kt`, `ServerDiscovery.kt`, `Notifications.kt`, `ScreenService.kt`, `BootReceiver.kt`, `iptv/{IptvDefaults,IptvRepository,M3uIptvProvider,M3uParser}.kt`, `iptv/ui/{CategoryAdapter,ChannelAdapter}.kt`
  - Resources (`res/drawable/`, `res/layout/`): `masaken_icon.png` (512x512 MAQAM TV icon), `bg_*.xml`, `welcome_gradient.xml`, `activity_*.xml`
- **CI/CD**: `.github/workflows/android_build.yml` (push to `iptvrepo main` -> builds signed `app-release.apk` using GitHub Secrets `MASAKEN_KEYSTORE_*` -> uploads Artifact & `latest` Release as `app-debug.apk`). Note: `GITHUB_FALLBACK_APK_URL` in `MainActivity.kt` points to `latest/download/app-debug.apk`.
- **Legacy Reference**: `mvp/` (v1 backup, ignored in git — do not edit unless comparing).

## 3. Production Server Topology (Proxmox CT 102)
- Nginx `:80` (`server_name _ masaken-tv.local`) -> `http://127.0.0.1:8899`.
- `masaken-server.service`: runs `/usr/local/bin/masaken-server-exec` (user `masaken`, dir `/opt/masaken-tvip`) reading `/run/masaken-public-url`.
- `masaken-tunnel.service`: runs `/usr/local/bin/masaken-tunnel-exec` (`cloudflared` quick tunnel) -> updates `/run/masaken-public-url` & restarts `masaken-server.service`. Note: quick tunnel URL rotates on tunnel/CT restart.

## 4. Token-Saving Rules & Maintenance for Every AI Session
1. **Check local env**: Use `/opt/homebrew/bin/python3`, `/opt/homebrew/bin/node`, `/opt/homebrew/bin/gh`. Never rely on `/usr/bin/python3` (Xcode license stub fails in sandbox).
2. **Respect screen isolation**: Load/browser tests MUST pass `platform="simulator"` (`&sim=1`); never touch physical `room-101` unless deploying to real TVs.
3. **Sync builds**: Web edits require bumping `?v=` in `index.html` & `CACHE_NAME` in `sw.js`. Android edits require bumping `versionCode` + `versionName` in `build.gradle.kts`, `MainActivity.getAppVersion()`, and `TvMonitor.kt`.
4. **Update this blueprint**: Whenever architecture, endpoints, version numbers, UI structure, or Proxmox setup changes, update `AGENTS.md` (and `.agents/rules/local-ops.md` for local credentials/IPs) cleanly before ending the task.
5. **Known pending hardening items**: Tech Menu PIN protection, room API PIN auth + rate limiting, dynamic offline Wi-Fi sync, auto-backup cron for `local_hotel_db.json`, and replacing quick tunnel with a named domain when available.
