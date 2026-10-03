import js from "@eslint/js";
import ts from "typescript-eslint";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  { ignores: ["dist/**", "**/dist/**", "web/dist/**", "quick-check.mjs"] },
];