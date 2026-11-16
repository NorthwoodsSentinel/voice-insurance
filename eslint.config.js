// Lint configuration: what `npm run lint` checks and what it never reads.
//
// Rule set: ESLint's `js.configs.recommended` with `_`-prefixed names allowed
// as unused, following the modelcontextprotocol/inspector root config
// (commit d330df9617e44ec893bc1a53618662239342d433). This repo is JavaScript
// only, so there is no typescript-eslint layer. `npm run lint` is
// `eslint . --max-warnings 0`: a warning fails exactly as an error does.
// Generated output (installed packages, coverage, scratch) is never linted.
// All code here runs under Node.

import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["node_modules/**", "coverage/**", ".scratch/**"]),
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
