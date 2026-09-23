# W0.2 hardware spike — run instructions

This is a **throwaway** Expo dev-client project. It is isolated from `mobile/` on purpose —
nothing here merges, nothing here is reused by the real app. Its only job is to answer GATE
M3's five questions (plan §C, W0.2) and let you read the answers off your own device.

It was built and statically verified (typecheck, lint, Metro bundle export for both platforms,
`expo-doctor`, and a `expo prebuild` dry run confirming the background-audio config actually
lands in `Info.plist`/`AndroidManifest.xml`) from an environment with **no Xcode and no Android
SDK** — so none of the five checks below have actually been run yet. That part is yours.

## 0. One-time setup

### Xcode (for iOS Simulator)

1. Check whether you already have it: `xcode-select -p`. If that prints
   `/Applications/Xcode.app/Contents/Developer`, skip to step 3.
2. Install Xcode from the Mac App Store (search "Xcode", it's free, ~15 GB, can take a while).
   After install, open it once so it finishes installing additional components, then run:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   ```
3. Confirm the Simulator runtime is present: `xcrun simctl list devices` should print a list,
   not an error.

### Android Studio (for the Android Emulator)

1. Download and install Android Studio from https://developer.android.com/studio.
2. On first launch, use the Setup Wizard to install the Android SDK and an emulator system
   image (any recent one, e.g. API 34).
3. In Android Studio: **Tools → Device Manager → Create Device**, pick a phone profile
   (e.g. Pixel 7) and the system image you installed. This is your AVD.
4. Make sure the SDK tools are on your `PATH` (Android Studio's SDK Manager shows the SDK
   location, typically `~/Library/Android/sdk`). Add to your shell profile if not already there:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
   ```
5. Confirm: `emulator -list-avds` should print the AVD you created.

### This project

```bash
cd mobile/spike
npm install
cp .env.example .env
```

Edit `.env`:
- `EXPO_PUBLIC_API_BASE_URL` — `http://localhost:8000` works for iOS Simulator. **Android
  Emulator cannot reach `localhost`** — use `http://10.0.2.2:8000` instead (the emulator's
  alias for the host machine's loopback). If you're testing both platforms you'll need to
  switch this between runs, or run two `.env` files.
- `EXPO_PUBLIC_TEST_SERMON_ID` — the W0.1 test sermon's UUID. `.env.example` has the exact
  `psql` query to find it (it's not the Stream UID `9a643f36f98569c72bcb995248a7bc85` — that's
  a separate id `mobile/spike/src/lib/env.ts` documents but never sends to the backend).

Make sure your local backend is actually running and on the latest migrations
(`docker compose up`, `alembic upgrade head` — same as any other local dev session).

## 1. Run it

This is a dev-client project with native modules (`expo-video`, `react-native-quick-crypto`),
**not** something Expo Go can run — you need a real dev-client build, which is what
`expo run:ios` / `expo run:android` produce (first run compiles the native project; this takes
several minutes the first time, seconds after).

```bash
# iOS Simulator
npx expo run:ios

# Android Emulator (make sure an AVD is running first, or pass --device to pick one)
npx expo run:android
```

Each command builds the app and launches it in the simulator/emulator automatically. On later
runs, once the native project exists, `npm run dev` (`expo start --dev-client`) is faster —
launch the app once via `run:ios`/`run:android`, then use `dev` for reloads.

## 2. What you'll see

One scrollable screen, five cards, numbered to match the dispatch:

| Card | What it proves | How to tell pass/fail |
|---|---|---|
| **Item 1** — expo-video plays the stream URL | Tap "Fetch GET /sermons/{id}/stream", then a variant chip, then Play/Pause/Seek. A banner tells you plainly whether you got a real **CLOUDFLARE STREAM** URL or the **S3 FALLBACK** (expected if `CF_STREAM_SIGNING_KEY_ID`/`_PEM` aren't set yet — check with Conductor/status.md if you're not sure). | Video/audio plays, seeking works, no error banner. |
| **Item 4** — lock-screen / notification controls | Uses the same player as item 1. After tapping Play there, lock your device (iOS) or check the notification shade (Android), or open Control Center. | Transport controls (play/pause, maybe seek) appear and work from the lock screen / notification. **This is the one item the plan's 2026-09-22 amendment flags as materially weaker on iOS Simulator than real hardware** — a clean simulator pass here is a good sign, not full confidence. |
| **Item 2** — audio-download endpoint, backgrounded + resumable | Tap "Start download", watch the progress bar. Tap "Pause (simulate drop)" mid-download, then "Resume from saved state" and confirm it finishes rather than restarting at 0%. Also background the app for a few seconds mid-download and see if progress kept moving when you return. | Download reaches 100% at least once via the resume path; progress bar and byte counts look sane. |
| **Item 3** — JSI crypto round trip (60 MB) | Tap "Encrypt + decrypt 60.0 MB". Read the SHA-256 line. | "MATCH", not "MISMATCH". A mismatch is a real fail — flag it, don't wave it off. |
| **Item 5** — decrypt-to-first-audio latency | Same button as item 3 — the number appears in large text on the second card. | Not a pass/fail — it's the number Isaac needs to read and record. Run it a handful of times (app freshly launched = "cold", repeated = "warm") and note the range. **This number, from a simulator, is provisional per the plan's amendment** — real, ideally older/lower-end, hardware is required before GATE M11, even if GATE M3 itself can proceed on the simulator number. |

## 3. Where to record results

Fill in this checklist and hand it back (paste into your reply, or straight into `status.md`
under a new `[MOBILE — W0.2 spike run results]` entry, same house style as the other W0.2
entries already in the file):

```
Device: <e.g. iOS Simulator, iPhone 15 Pro, iOS 18.x>  /  <e.g. Android Emulator, Pixel 7, API 34>
Item 1 (Stream/S3 playback):     PASS / FAIL — URL kind seen: STREAM / S3 FALLBACK — notes:
Item 2 (download + resume):      PASS / FAIL — notes:
Item 3 (crypto round trip):      PASS / FAIL — notes:
Item 4 (lock-screen controls):   PASS / FAIL — notes:
Item 5 (decrypt latency, ms):    cold: ___ ms   warm (x3): ___ / ___ / ___ ms
Screenshots/recording for item 1: <attach or describe>
```

A "it worked" one-liner isn't enough — the plan is explicit that this spike needs actual
evidence (screenshots/recording for item 1, the real numbers for item 5), not a verbal pass.

## 4. Known, already-flagged gaps (not yours to fix here)

- If `CF_STREAM_SIGNING_KEY_ID`/`_PEM` aren't set on the backend yet, item 1 will only prove
  S3-fallback playback, not genuine Stream HLS — the on-screen banner tells you which one you
  got. That's expected, not a bug in this spike.
- Item 5's number from a simulator is provisional (plan §M amendment, 2026-09-22) — real-device
  re-measurement is a condition on GATE M11, not GATE M3.
- This spike does not implement app-kill-mid-download persistence (only in-process
  pause/resume via `DownloadTask.savable()`/`fromSavable()`) — a true "app was killed, not just
  backgrounded" resume would need the saved state written to disk between runs, which is a
  reasonable next question if item 2's in-process resume looks solid but you want to push
  further, not something this spike claims to prove.
