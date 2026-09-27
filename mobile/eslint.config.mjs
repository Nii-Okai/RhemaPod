import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

const eslintConfig = defineConfig([
  globalIgnores([
    ".expo/**",
    ".expo-shared/**",
    "node_modules/**",
    "dist/**",
    "build/**"
  ]),
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // RN's JS runtime provides the fetch API globally (no DOM/browser
        // env otherwise) and Metro/Expo statically inlines `process.env.
        // EXPO_PUBLIC_*` — neither is covered by `globals.node`/`globals.
        // browser`, which assume environments this app doesn't have.
        fetch: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        RequestInit: "readonly",
        AbortController: "readonly",
        FormData: "readonly",
        URLSearchParams: "readonly",
        process: "readonly",
        // RN's JS runtime (JSC/Hermes) provides the timer functions globally too —
        // same rationale as fetch/Headers/etc above. First real caller: the W4.3
        // search-suggest debounce (lib/hooks/useDebouncedValue.ts).
        setTimeout: "readonly",
        clearTimeout: "readonly",
        // First real caller: W4.2's progress-flush interval and sleep-timer countdown
        // (app/player/_player/useProgressFlush.ts, useSleepTimer.ts).
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
  {
    files: ["**/*.config.{js,mjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // `__mocks__/**` (Jest manual mocks, not test files themselves) needs the same
    // `jest` global as `__tests__/**` whenever a mock uses `jest.fn()` — first real
    // caller: `__mocks__/expo-video.tsx` (W4.2). The pre-existing `@expo/vector-icons`
    // mock never needed it, which is why this gap was invisible until now.
    files: ["**/__tests__/**/*.{js,ts,tsx}", "**/*.test.{js,ts,tsx}", "**/__mocks__/**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
]);

export default eslintConfig;
