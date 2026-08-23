import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { sogioPlugin } from "./eslint-rules/index.js";

const IGNORED_SCHEMA_NAMES = [
  "^outputSchema$",
  "OutputSchema$",
  "ResponseSchema$",
  "^envSchema$",
];

export default defineConfig([
  {
    files: ["src/**/*.{ts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "error",
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { sogio: sogioPlugin },
    rules: {
      "sogio/zod-int-bounds": [
        "error",
        { ignoredSchemaNames: IGNORED_SCHEMA_NAMES },
      ],
      "sogio/zod-string-max": [
        "error",
        { ignoredSchemaNames: IGNORED_SCHEMA_NAMES },
      ],
    },
  },
  {
    files: ["src/**/application/handler/**/*.ts"],
    plugins: { sogio: sogioPlugin },
    rules: {
      "sogio/handler-only-event-handlers": "error",
    },
  },
  {
    files: ["src/**/application/service/**/*.ts"],
    plugins: { sogio: sogioPlugin },
    rules: {
      "sogio/service-only-service-objects": "error",
    },
  },
]);
