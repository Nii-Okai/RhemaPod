# RhemaPod Mobile App

Expo-based React Native app for iOS, Android, and tablet platforms, built with TypeScript and Expo Router.

## Local setup

```bash
# Install dependencies
npm install

# Create .env from .env.example
cp .env.example .env

# Start dev build
npm run dev
```

## Development

- **typecheck**: `npm run typecheck`
- **lint**: `npm run lint`
- **test**: `npm run test`
- **verify all**: `npm run verify`

## Platform-specific

- **iOS**: `npm run ios`
- **Android**: `npm run android`

## Shipping a fix without a store release

JavaScript and asset fixes go out over the air with EAS Update:
testers get them automatically when the change is merged into the `uat` branch
(TestFlight and the internal Android APK both listen on the `uat` channel). Native
changes still need a bump of `expo.version` in `app.json`; the next push to `uat`
then makes new builds. Channels, staged rollouts and rollback: `docs/ota-updates.md`.

## Route structure

- `(auth)` — Authentication screens (sign-in, register, forgot-password)
- `(tabs)` — Main tab navigation (home, browse, search, downloads, me)

See the plan at `../plans/plan-mobile-app.md` for full architecture and feature details.
