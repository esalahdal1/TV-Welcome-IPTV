#!/usr/bin/env bash
set -euo pipefail

# سكربت تجهيز شاشات مساكن النزهة عبر ADB (58 غرفة + 9 صالات)
# يقوم بتثبيت تطبيق الفندق + مستقبل البث AirScreen (اختياري) + منح الصلاحيات + ضبط الغرفة/الصالة تلقائياً.

PKG_APP="com.example.tv_guest_welcome"
PKG_AIRSCREEN="com.ionitech.airscreen"

TVIP_APK="${TVIP_APK:-android/app/build/outputs/apk/debug/app-debug.apk}"
AIRSCREEN_APK="${AIRSCREEN_APK:-apk/airscreen.apk}"
M3U_URL="${M3U_URL:-}"
SET_LAUNCHER="${SET_LAUNCHER:-0}"

usage() {
  cat <<'EOF'
الاستخدام:
  1) تجهيز شاشة غرفة واحدة:
     ./scripts/provision_tv.sh <TV_IP> room <ROOM_NUMBER> [M3U_URL]

  2) تجهيز شاشة صالة / ممر:
     ./scripts/provision_tv.sh <TV_IP> lobby [M3U_URL]

  3) تجهيز جميع الـ 67 شاشة من ملف CSV:
     ./scripts/provision_tv.sh --csv scripts/tv_fleet.csv

متغيرات بيئية اختيارية:
  TVIP_APK=path/to/app-debug.apk
  AIRSCREEN_APK=path/to/airscreen.apk
  SET_LAUNCHER=1    (لتعيين التطبيق كواجهة رئيسية عبر ADB عند توفر الصلاحية)
EOF
}

grant_pkg_permissions() {
  local target="$1"
  local pkg="$2"
  adb -s "$target" shell appops set "$pkg" SYSTEM_ALERT_WINDOW allow >/dev/null 2>&1 || true
  adb -s "$target" shell pm grant "$pkg" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
  adb -s "$target" shell dumpsys deviceidle whitelist +"$pkg" >/dev/null 2>&1 || true
}

provision_one() {
  local ip="$1"
  local mode="$2"
  local room="${3:-}"
  local row_m3u="${4:-$M3U_URL}"

  local target="$ip"
  if [[ "$ip" != *:* ]]; then
    target="${ip}:5555"
  fi

  echo "=================================================="
  echo "جاري الاتصال بالشاشة: $target (الوضع: $mode ${room:+- غرفة: $room})"
  adb connect "$target"

  if ! adb -s "$target" get-state >/dev/null 2>&1; then
    echo "[خطأ] تعذر الاتصال عبر ADB بالشاشة $target"
    return 1
  fi

  if [[ -f "$TVIP_APK" ]]; then
    echo "-> تثبيت تطبيق masaken hotel..."
    adb -s "$target" install -r -g "$TVIP_APK" || adb -s "$target" install -r "$TVIP_APK"
  else
    echo "[تحذير] ملف APK الرئيسي غير موجود في $TVIP_APK — سيتم ضبط الإعدادات فقط إن كان مثبتاً."
  fi

  grant_pkg_permissions "$target" "$PKG_APP"
  adb -s "$target" shell appops set "$PKG_APP" REQUEST_INSTALL_PACKAGES allow >/dev/null 2>&1 || true

  if [[ -f "$AIRSCREEN_APK" ]]; then
    echo "-> تثبيت مستقبل البث AirScreen ومنح الصلاحيات..."
    adb -s "$target" install -r -g "$AIRSCREEN_APK" || adb -s "$target" install -r "$AIRSCREEN_APK"
    grant_pkg_permissions "$target" "$PKG_AIRSCREEN"
  fi

  if [[ "$SET_LAUNCHER" == "1" ]]; then
    adb -s "$target" shell cmd package set-home-activity "${PKG_APP}/.MainActivity" >/dev/null 2>&1 || true
    adb -s "$target" shell cmd role add-role-holder android.app.role.HOME "$PKG_APP" >/dev/null 2>&1 || true
  fi

  local friendly_name="Masaken Lobby"
  if [[ "$mode" == "room" && -n "$room" ]]; then
    friendly_name="Masaken Room ${room}"
  fi
  adb -s "$target" shell settings put global device_name "$friendly_name" >/dev/null 2>&1 || true
  adb -s "$target" shell settings put secure bluetooth_name "$friendly_name" >/dev/null 2>&1 || true

  echo "-> تطبيق الإعدادات وتشغيل الشاشة تلقائياً ($friendly_name)..."
  local cmd=(adb -s "$target" shell am start -n "${PKG_APP}/.SetupActivity" --es extra_mode "$mode" --ez extra_auto_save true)
  if [[ "$mode" == "room" ]]; then
    if [[ -z "$room" ]]; then
      echo "[خطأ] رقم الغرفة مطلوب في وضع room"
      return 1
    fi
    cmd+=(--es extra_room "$room")
  fi
  if [[ -n "$row_m3u" ]]; then
    cmd+=(--es extra_m3u_url "$row_m3u")
  fi

  "${cmd[@]}"
  echo "[تم بنجاح] $target"
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "[خطأ] أداة adb غير مثبتة. ثبّت Android Platform Tools أولاً (مثل brew install android-platform-tools)."
  exit 1
fi

if [[ "${1:-}" == "--csv" ]]; then
  csv_file="${2:-}"
  if [[ -z "$csv_file" || ! -f "$csv_file" ]]; then
    echo "[خطأ] ملف CSV غير موجود: $csv_file"
    exit 1
  fi
  while IFS=, read -r ip mode room row_m3u || [[ -n "${ip:-}" ]]; do
    ip="$(echo "${ip:-}" | tr -d '\r' | xargs)"
    mode="$(echo "${mode:-}" | tr -d '\r' | xargs)"
    room="$(echo "${room:-}" | tr -d '\r' | xargs)"
    row_m3u="$(echo "${row_m3u:-}" | tr -d '\r' | xargs)"
    [[ -z "$ip" || "$ip" == \#* || "$ip" == "ip" ]] && continue
    provision_one "$ip" "$mode" "$room" "$row_m3u" || echo "[فشل] $ip"
  done < "$csv_file"
  exit 0
fi

IP_ARG="$1"
MODE_ARG="${2:-room}"
if [[ "$MODE_ARG" == "lobby" ]]; then
  provision_one "$IP_ARG" "lobby" "" "${3:-$M3U_URL}"
else
  provision_one "$IP_ARG" "room" "${3:-}" "${4:-$M3U_URL}"
fi
