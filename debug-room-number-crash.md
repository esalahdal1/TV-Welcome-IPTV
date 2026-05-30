[OPEN] Debug Session: room-number-crash

## Symptom
- App closes immediately after entering/saving the room number (Setup screen).

## Expected
- After saving the room number, the app should navigate to the welcome screen without crashing.

## Environment
- Device: Xiaomi TV Stick / Android TV (ADB connected)
- App package: com.example.tv_guest_welcome

## Hypotheses (falsifiable)
1) Setup save triggers an in-app banner (notification overlay) that crashes due to invalid `View.setTag(int, ...)` key.
2) A permission flow (POST_NOTIFICATIONS / overlay) triggers an exception on some devices right after save.
3) MainActivity WebView initialization triggers a crash when launched immediately after saving room number.
4) Notification polling/scheduling runs on the wrong thread and crashes when binding foreground UI.

## Evidence Collected
- Logcat crash shows `IllegalArgumentException: The key must be an application-specific resource id.` in `InAppBanner.show`.

## Plan
1) Fix banner storage to avoid `View.setTag(int, ...)` with non-resource keys.
2) Reinstall and reproduce “save room number” flow.
3) Confirm no crash and banner still auto-hides after 5 seconds.

