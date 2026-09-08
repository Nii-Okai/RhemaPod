This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Toolchain

Requires **Node 24** (see `.nvmrc` / `engines`). Vitest 5 and `next build` will not run on older lines. With `nvm`: `nvm use`. If Node 24 is a keg-only Homebrew install, put it on `PATH` first: `export PATH=/usr/local/opt/node@24/bin:$PATH`.

## Testing

`npm test` runs Vitest across two projects (`vitest.config.mts`):

- **node** — `tests/**/*.test.{ts,tsx}` (excluding `*.dom.*`). Pure logic and
  the MSW-backed API/BFF transport suites. `environment: "node"`, setup
  `tests/setup.ts`.
- **dom** — `tests/**/*.dom.test.{ts,tsx}`. Component and hook render tests
  under `happy-dom` with `@testing-library/react` + `@testing-library/user-event`.
  `environment: "happy-dom"`, setup `tests/setup.dom.ts` (jest-dom matchers +
  `afterEach(cleanup)`).

Run one project with `npx vitest run --project node|dom`. Playwright's one
happy-path suite is `npm run test:e2e`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
