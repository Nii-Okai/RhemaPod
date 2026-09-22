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

## Route structure

- `(auth)` — Authentication screens (sign-in, register, forgot-password)
- `(tabs)` — Main tab navigation (home, browse, search, downloads, me)

See the plan at `../plans/plan-mobile-app.md` for full architecture and feature details.
