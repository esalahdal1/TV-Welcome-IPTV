# masaken hotel — Android TV Welcome + IPTV

This project is an **Android TV / Fire TV / Xiaomi TV Stick** app that combines:

1) A **WebView-based “Welcome” page** hosted on **GitHub Pages** (HTML/CSS/JS).
2) A native **IPTV player** (Media3/ExoPlayer) with remote-friendly navigation.
3) A simple **notifications system** (admin page → Supabase table → TV devices), shown as:
   - A translucent in-page toast on the **welcome web page**.
   - A translucent in-app banner on **native screens** (IPTV list + player).
   - A standard Android notification when the app is not in the foreground.

The goal is: “a hotel/serviced apartments guest welcome experience” that works with **remotes without numeric keys**.

---

## Key Links

- GitHub Pages (welcome web page): `https://esalahdal1.github.io/TV-Welcome/`
- Admin page: `https://esalahdal1.github.io/TV-Welcome/?admin=1`
  - PIN: `1234`
- Android APK direct download (CI Release tag `latest`):
  - `https://github.com/esalahdal1/TV-Welcome-IPTV/releases/download/latest/app-debug.apk`

---

## Remote Control Behavior (DPAD)

Welcome (WebView):
- Uses OK/Enter navigation (no numeric keys required).

IPTV Player:
- LEFT: previous channel
- RIGHT / DOWN: next channel
- UP: open “channel picker” (horizontal browsing list)
- OK: show/hide player controls
- BACK: exit player

Channel Picker:
- Shows a visible focus highlight so you always know what item is selected.
- Selecting a channel from the picker **does not open a second PlayerActivity**; it reuses the existing player screen.

---

## How Guest Name Works (Important)

The Android app does **not** fetch the guest name.

The **web page** reads the room number from the URL:

`https://.../TV-Welcome/?room=ROOM_NUMBER`

Then it queries Supabase:

- Table: `public.guests`
- Filter: `room_number == room`
- Field used: `full_name`

---

## Supabase: Required Tables

This project uses Supabase from the web page (public client). Because the site is hosted publicly, you must configure **RLS** to only expose the minimal data.

### A) Guests (welcome page)

- Table: `public.guests`
- Columns used:
  - `room_number` (text)
  - `full_name` (text)
- Setup script: `sql/supabase_guests_table_and_rls.sql`

### B) Notifications (admin page → devices)

- Table: `public.tv_notifications`
- Columns:
  - `room_number` (text, nullable)  
    - `NULL` means “send to everyone”
  - `message` (text)
  - `created_at` (timestamptz)

If you haven’t created it yet, you can create it with:

```sql
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tv_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  room_number text null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists tv_notifications_created_at_idx
  on public.tv_notifications (created_at);

alter table public.tv_notifications enable row level security;

drop policy if exists tv_notifications_select on public.tv_notifications;
create policy tv_notifications_select
  on public.tv_notifications
  for select
  using (true);

drop policy if exists tv_notifications_insert on public.tv_notifications;
create policy tv_notifications_insert
  on public.tv_notifications
  for insert
  with check (true);
```

---

## Project Structure

### Web (GitHub Pages)

- `index.html`  
  - Welcome UI (Arabic branding, Riyadh timezone clock, Hijri date).
  - Guest name lookup via Supabase JS.
  - Weather widget.
  - Admin panel (PIN “1234”) for sending notifications.
  - In-page toast notifications.

### Android App (Kotlin)

- `android/app/src/main/kotlin/com/example/tv_guest_welcome/MainActivity.kt`
  - Reads `room_number` from `SharedPreferences` (`TV_PREFS`).
  - If not set, opens setup screen.
  - Otherwise loads GitHub Pages URL in WebView with `?room=...`.
  - Includes an in-app “Update” button (downloads the latest APK from GitHub Releases).

- `android/app/src/main/kotlin/com/example/tv_guest_welcome/SetupActivity.kt`
  - First-time setup: asks for overlay permission and room number.

- IPTV
  - `QuickPlayActivity.kt` (quick play channel #1)
  - `ChannelsActivity.kt` (channel list / picker)
  - `PlayerActivity.kt` (Media3 player; DPAD navigation)
  - `iptv/` (repository/provider/parser, caching, playback queue)

- Notifications
  - `Notifications.kt`
    - Polls Supabase REST for new rows in `tv_notifications`.
    - Shows banners on native screens.
    - Shows Android notifications when app is not in foreground.

- Auto-start after boot (best-effort)
  - `BootReceiver.kt` + `ScreenService.kt`
  - Note: on many Android TV/Android 14 devices, **background activity launch is blocked** (BAL). This cannot be guaranteed without launcher/system privileges.

---

## Building & Releases (GitHub Actions)

Workflow file: `.github/workflows/android_build.yml`

- Builds `assembleRelease`
- Uploads APK as GitHub Release asset under tag: `latest`
- Direct download URL stays stable:
  `.../releases/download/latest/app-debug.apk`

---

## Installing on Android TV / Fire Stick / Xiaomi Stick (Recommended)

Some devices fail “staged install” from Downloads/USB. The most reliable approach is installing from `/data/local/tmp`:

```bash
adb devices
adb push app-debug.apk /data/local/tmp/masaken-hotel.apk
adb shell pm install -r /data/local/tmp/masaken-hotel.apk
```

### If you see signature mismatch

Error:
`INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`

Fix (will clear app data):

```bash
adb uninstall com.example.tv_guest_welcome
adb shell pm install /data/local/tmp/masaken-hotel.apk
```

If you want updates without losing data, you must sign all builds with a **stable keystore**.

---

## Troubleshooting

- “App closes after saving room number”
  - Root cause was a banner tag-key crash on some Android TV builds. Fixed in `Notifications.kt`.

- “Weather shows —”
  - Some weather providers fail in TV WebView due to CORS/network restrictions. This project uses a CORS-friendly provider.

- “Notifications not arriving”
  - Check that `tv_notifications` table exists and RLS allows `select` and `insert`.
  - If the TV has no internet, polling cannot work.

---

## One-Prompt “Rebuild This App” (AI Template)

Copy/paste the following prompt into any AI assistant.  
Replace the placeholders with your actual GitHub repo and Supabase info.

```text
You are a senior full-stack mobile engineer. Build a project that replicates the following app exactly:

INPUTS:
1) GitHub repo URL: <GITHUB_REPO_URL>
2) Supabase project URL: <SUPABASE_URL>
3) Supabase anon/publishable key: <SUPABASE_ANON_KEY>

DELIVERABLES:
A) A GitHub Pages web app (single index.html) with:
   - Arabic hotel branding (masaken hotel), Riyadh timezone clock, Hijri date.
   - Guest name section (#guestName) that shows “ضيفنا العزيز” when no room, otherwise queries Supabase table `public.guests` for `full_name` by `room_number`.
   - Weather widget displayed on the page.
   - Admin page mode triggered by `?admin=1` protected with PIN 1234:
       * List current occupied apartments (room number + guest name from `guests`).
       * Button “send to all” writes a row into `public.tv_notifications` with `room_number = NULL`.
       * Per-room send button writes into `public.tv_notifications` with `room_number = <room>`.
   - When a notification is received and the welcome page is open: show a translucent top toast for 5 seconds.

B) An Android TV app (Kotlin) with:
   - Setup screen (room number saved in SharedPreferences TV_PREFS/room_number).
   - MainActivity loads the GitHub Pages URL in WebView: `...?room=<room>`.
   - IPTV feature:
       * Down from welcome opens IPTV quick play (channel #1).
       * Player supports DPAD left/right (prev/next), up opens a channel picker list, OK toggles controls.
       * Channel picker shows a visible focus highlight; selecting a channel reuses PlayerActivity (no stacking).
   - Notifications:
       * Poll Supabase `tv_notifications` and show:
         - in-app translucent banner on native screens (IPTV list + player) for 5 seconds
         - Android system notification if app is not in foreground
       * “send to all” messages must work even if room is not set yet.
   - In-app “Update” button downloads latest APK from GitHub Releases tag `latest` and starts install.

DATABASE:
1) Provide SQL to create `public.guests` with RLS suitable for public read of only `room_number` and `full_name`.
2) Provide SQL to create `public.tv_notifications` with RLS suitable for public insert/select.

CONSTRAINTS:
- Remote-friendly UI (no touch required).
- Do not require numeric remote buttons.
- Do not log or hardcode secrets beyond the Supabase anon key.

ACCEPTANCE:
- Room save does not crash.
- Notifications show on welcome page, IPTV list, and IPTV player.
- Selecting from channel picker does not open multiple player screens.
```
