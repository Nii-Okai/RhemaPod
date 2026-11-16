# Local development — running everything

Three independent things run for local dev: the backend stack (Docker), the admin portal
(Next.js), and the mobile app (Expo). None of them depend on being started in any particular
order except the backend must be up before the admin portal or mobile app can talk to it.

## 0. Prerequisites (one-time, per machine)

- Docker Desktop running.
- Node.js 24+, `npm`.
- For iOS device/simulator builds: Xcode + command-line tools (`xcode-select -p` should print a
  real path, not empty).
- For Android device/emulator builds: Android SDK with **platform-tools** and **a real, stable
  system image** installed (not a preview/canary one — `sdkmanager --list_installed` should show
  something like `system-images;android-35;google_apis_playstore;arm64-v8a`, not `android-3X.Y`
  preview builds).
- `mobile/.env` must exist (gitignored, not in git) with your Mac's actual LAN IP, not
  `localhost` — see §3.3 for why.

### The PATH gotcha

Some shells (including this session's) don't source `~/.zshrc`, so `docker`, `node`, `npm`,
`npx`, and `adb` can all come back "command not found" even though they're installed. If that
happens, prepend:

```bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$HOME/Library/Android/sdk/cmdline-tools/latest/bin:$PATH"
```

to your command, or add it to your actual shell profile if it keeps happening in your own
terminal too.

## 1. Backend (Docker: postgres, redis, api)

```bash
cd /Users/isaacokai/Downloads/Project/fastapi_sermon
docker compose up -d
```

First run (or after a Dockerfile/dependency change) rebuilds the image, which takes a few
minutes. Subsequent runs reuse the cached image and come up in seconds.

**Check it's healthy:**

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/health/live   # expect 200
```

**If you get a fresh/empty Postgres volume** (new machine, `docker compose down -v`, or a
"relation ... does not exist" error), migrations need to run once:

```bash
docker compose run --rm migrate
```

**Restart just the api** (after a config/code change, without rebuilding):

```bash
docker compose restart api
```

**Rebuild after a dependency or Dockerfile change:**

```bash
docker compose up -d --build
```

**Full stop:**

```bash
docker compose down          # keeps the postgres/redis volumes
docker compose down -v       # also wipes the volumes — you will need to re-run migrations
```

Two extra one-shot services exist, both profile-gated so `docker compose up` never starts them
by accident:

```bash
docker compose --profile sweeps up -d sweeps      # background upload/subscription sweeps
docker compose --profile ops run --rm archive-sweep   # R2→AWS archive sweep, one-shot
```

## 2. Admin portal (Next.js)

```bash
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/admin_portal
npm run dev
```

Ready at `http://localhost:3000`. Reads `.env.local` for its own config. Just `Ctrl+C` and re-run
to restart; Turbopack picks up code changes live without a restart.

## 3. Mobile app (Expo)

### 3.1 Start the JS bundler (Metro)

```bash
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/mobile
npx expo start --dev-client
```

Serves the JS bundle at `http://localhost:8081`. This alone does **not** put anything on a
device — a native "dev client" build has to already be installed there (see §3.2/§3.4), and it
connects to whatever Metro instance the app is pointed at.

**Restart Metro** (needed after a native dependency change, or if the bundler cache is stale):

```bash
# Ctrl+C the running instance, then:
npx expo start --dev-client --clear      # --clear busts the Metro cache
```

### 3.2 Build and install onto a device — iOS

List available simulators and connected physical devices:

```bash
xcrun xctrace list devices
```

Build and install (swap the identifier for a simulator UDID or a physical device UDID from the
list above):

```bash
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/mobile
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device "<UDID>" --no-bundler
```

(`LANG`/`LC_ALL` work around a CocoaPods/Ruby locale bug that otherwise crashes `pod install`.
`--no-bundler` assumes Metro is already running per §3.1, on the default port.)

**First launch on a physical device** will fail with a code-signing/trust error — this is
expected, not a bug:

> Unable to launch ... because it has an invalid code signature, inadequate entitlements or its
> profile has not been explicitly trusted by the user.

Fix once per device: **Settings → General → VPN & Device Management → [your developer team] →
Trust**. Then relaunch without rebuilding:

```bash
xcrun devicectl device process launch --device "<UDID>" org.name.RhemaPod
```

**When you need a full rebuild** (native dependency added/changed, e.g. after `expo install
<package>`): re-run the `expo run:ios` command above. When you only changed JS/TS code with no
native dependency change: just reload the running app (shake device → Reload, or fully close and
reopen it) — no rebuild needed.

### 3.3 Build and install onto a device — Android

```bash
adb devices -l    # confirm a device/emulator shows up first
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/mobile
npx expo run:android --device "<serial or emulator id>" --no-bundler
```

If `adb devices` shows nothing: a physical device needs USB debugging enabled (Settings →
Developer Options → USB debugging) and to be unlocked with a "trust this computer" prompt
accepted; an emulator needs a working AVD with a real (non-preview) system image installed — see
§0.

### 3.4 The two most likely gotchas after a fresh clone or a long gap

1. **`EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` pointing at `localhost`.** That only works from
   an iOS *Simulator* (which shares the Mac's network namespace). A physical device or an Android
   emulator needs the Mac's actual LAN IP:

   ```bash
   ipconfig getifaddr en0   # or: ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

   Put that IP in `mobile/.env` as `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8000`, confirm the
   backend is actually reachable there (`curl http://<LAN-IP>:8000/health/live`), then fully
   restart Metro with `--clear` (env vars are baked in at bundle time, a plain reload isn't
   enough).

2. **Dependency drift.** If a fresh build fails with a Swift/native compile error inside an
   `expo-*` or `@expo/*` package (not your own code), check whether `package.json` has drifted
   from what the installed Expo SDK expects:

   ```bash
   npx expo install --check     # lists anything outdated
   npx expo install --fix       # corrects it
   ```

## 4. Quick reference — "just get everything running"

```bash
# Terminal 1 — backend
cd /Users/isaacokai/Downloads/Project/fastapi_sermon && docker compose up -d

# Terminal 2 — admin portal
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/admin_portal && npm run dev

# Terminal 3 — mobile JS bundler
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/mobile && npx expo start --dev-client

# Terminal 4 (only if a fresh native build/install is needed) — iOS
cd /Users/isaacokai/Downloads/Project/fastapi_sermon/mobile
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device "<UDID>" --no-bundler
```
