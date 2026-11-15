# Over-the-air updates (EAS Update)

JavaScript and asset fixes reach phones without a store release. The app checks for
an update on every cold start and downloads it in the background (launch is never
delayed), and checks again when it comes back to the foreground after 30 minutes or
more. A downloaded update runs from the next cold start; the app never reloads
itself mid-sermon. Code: `mobile/lib/updates/otaUpdates.ts`, `mobile/app.json`
(`updates`, `runtimeVersion`), `mobile/eas.json` (`channel` per profile).

## Channels

| Build profile      | Channel       | Who has it                        |
| ------------------ | ------------- | --------------------------------- |
| `development`      | `development` | dev client builds                 |
| `preview`          | `preview`     | internal preview builds           |
| `android-internal` | `staging`     | the internal Android APK          |
| `testflight`       | `production`  | TestFlight and App Store (iOS)    |
| `production`       | `production`  | (base of `testflight`)            |

A build only ever receives updates published to its own channel, and only updates
with the same runtime version.

## What an update can and cannot carry

An update carries JavaScript, images and fonts. It cannot carry native changes: a new
package with native code, a config plugin, a permission, an `app.json` change, a
change under `mobile/modules/`, `mobile/plugins/` or `mobile/patches/`.

The runtime version is the app version (`expo.version` in `app.json`). **After any
native change, bump `expo.version` and make new builds.** Old builds then stop
receiving updates meant for the new native code, which is what keeps an update from
crashing a build it doesn't fit.

## Publishing a fix

Always publish with the script, never plain `eas update`:

```sh
cd mobile
npm run update -- --channel staging --message "Fix the sleep timer"
```

The script:

- sets the channel's `EXPO_PUBLIC_*` values from its build profile in `eas.json`
  (plain `eas update` ignores them and would point the app at `localhost`), and uses
  the profile's EAS environment so EAS environment variables such as the Sentry DSN
  are included;
- refuses to publish uncommitted code;
- looks up the newest finished build on the channel and refuses if native-side files
  changed since that build's commit (override with `--force` only when you are sure
  the change is JavaScript-only, e.g. a pure-JS dependency);
- uploads source maps to Sentry when `SENTRY_AUTH_TOKEN` is set in your shell, so
  crash stack traces from the update are readable. Crash reports are tagged with the
  update id and channel.

`--dry-run` prints what it would do.

## Staging, then production in steps

1. Publish to `staging`, open the internal Android APK twice (the first launch
   downloads, the second runs it) and check the fix.
2. Publish the same commit to production for a slice of users:
   `npm run update -- --channel production --rollout 10`
3. Watch Sentry for the new update id. If it looks healthy, raise the rollout with
   `npx eas-cli update:edit` (pick the update, set the percentage to 100).

## Rolling back

- **Bad update:** `npx eas-cli update:rollback` and choose the channel. It either
  republishes the previous update or tells phones to go back to the bundle built
  into the app. Phones pick that up on their next launch.
- **Bad partial rollout:** `npx eas-cli update:revert-update-rollout`.
- **Crash on launch:** expo-updates already handles this on the phone: if an update
  crashes before the app has loaded, the next launch falls back to the previous
  working update or the built-in bundle.

You need to be logged in (`npx eas-cli login`) as an account with access to the
`wedid-system` Expo project.
