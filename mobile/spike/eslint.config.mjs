import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

// Mirrors mobile/eslint.config.mjs's shape (consistency for whoever reads
// this next), deliberately not shared/imported from it — this project is
// isolated by design (mobile/spike/README.md), nothing here merges.
const eslintConfig = defineConfig([
  globalIgnores([".expo/**", "node_modules/**", "ios/**", "android/**", "dist/**"]),
  js.configs.recommended,
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
        fetch: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        console: "readonly",
        process: "readonly",
        require: "readonly",
        __DEV__: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
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
]);

export default eslintConfig;
