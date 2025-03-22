import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{ts,tsx}"], // Only check TypeScript files
    languageOptions: { globals: globals.browser }
  },
  {
    files: ["**/*.{ts,tsx}"], // Only check TypeScript files
    plugins: { js },
    extends: ["js/recommended"]
  },
  tseslint.configs.recommended,
]);
