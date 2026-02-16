// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import depend from "eslint-plugin-depend";
import { defineConfig } from "eslint/config";
import eslintComments from "eslint-plugin-eslint-comments";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    // Avoid type-aware rule errors on config/build output files.
    ignores: ["eslint.config.mjs", "main.js", "main.js.map"],
  },
  {
    files: ["**/*.{js,cjs,mjs,jsx,ts,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      "eslint-comments": eslintComments,
    },
    rules: {
      "eslint-comments/no-unused-disable": "error",
      "eslint-comments/require-description": "error",
      "eslint-comments/no-restricted-disable": [
        "error",
        "@typescript-eslint/no-explicit-any",
        "obsidianmd/ui/sentence-case",
      ],
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["package.json"],
    plugins: {
      depend,
    },
    rules: {
      "depend/ban-dependencies": [
        "error",
        {
          presets: ["native", "microutilities", "preferred"],
          allowed: ["eslint-plugin-eslint-comments"],
        },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        document: "readonly",
        window: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        activeWindow: "readonly",
        console: "readonly",
      },
    },

    // You can add your own configuration to override or add rules
    rules: {
      "@typescript-eslint/require-await": "error",
    },
  },
  {
    // ollamaService.ts needs the native fetch API for streaming responses
    // — requestUrl does not support ReadableStream / NDJSON streaming.
    files: ["src/utils/ollamaService.ts"],
    languageOptions: {
      globals: {
        fetch: "readonly",
        Response: "readonly",
        ReadableStreamDefaultReader: "readonly",
        RequestInit: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": "off",
    },
  },
]);
