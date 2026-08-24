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

const SINGLE_TRANSPORT_SURFACES = [
  "src/backoffice/presentation/controller/**/*.ts",
  "src/auth/presentation/controller/auth/change_password.controller.ts",
  "src/auth/presentation/controller/auth/register_user.controller.ts",
  "src/auth/presentation/controller/auth/request_password_reset.controller.ts",
  "src/auth/presentation/controller/auth/reset_password.controller.ts",
  "src/auth/presentation/controller/auth/sign_in.controller.ts",
  "src/auth/presentation/controller/delegated_access/**/*.ts",
  "src/billing/presentation/controller/create_checkout_session.controller.ts",
  "src/billing/presentation/controller/create_billing_portal_session.controller.ts",
  "src/billing/presentation/controller/stripe_webhook.controller.ts",
  "src/billing/presentation/controller/sync_plan_catalog.controller.ts",
  "src/booking/presentation/controller/stay/get_public_stay.controller.ts",
  "src/booking/presentation/mcp_tool/import_stays.mcp_tool.ts",
  "src/finance/presentation/mcp_tool/import_ledger_entries.mcp_tool.ts",
  "src/property_management/presentation/mcp_tool/import_properties.mcp_tool.ts",
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
      "sogio/zod-array-max": [
        "error",
        { ignoredSchemaNames: IGNORED_SCHEMA_NAMES },
      ],
      "sogio/zod-int-bounds": [
        "error",
        { ignoredSchemaNames: IGNORED_SCHEMA_NAMES },
      ],
      "sogio/zod-string-max": [
        "error",
        { ignoredSchemaNames: IGNORED_SCHEMA_NAMES },
      ],
      "sogio/zod-format-shorthand": "error",
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
  {
    files: [
      "src/**/presentation/controller/**/*.ts",
      "src/**/presentation/mcp_tool/**/*.ts",
    ],
    ignores: SINGLE_TRANSPORT_SURFACES,
    plugins: { sogio: sogioPlugin },
    rules: {
      "sogio/no-inline-input-schema": "error",
    },
  },
]);
