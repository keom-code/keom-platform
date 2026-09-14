// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared base ESLint flat config for all KEOM packages/apps. */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", "coverage/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

export default baseConfig;
