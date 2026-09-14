import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 作業用。DB・ログ・E2E の生成物が増えても lint の対象にしない。
    ".tmp/**",
    // Playwright の生成物（.gitignore にも入っている）。
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
