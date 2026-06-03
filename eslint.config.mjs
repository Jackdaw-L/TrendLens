import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const generatedFileIgnores = {
  ignores: [
    "node_modules/**",
    ".next/**",
    ".netlify/**",
    "out/**",
    "build/**",
    "data/logs/**",
    "next-env.d.ts",
  ],
};

const eslintConfig = [
  generatedFileIgnores,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ...generatedFileIgnores,
  },
];

export default eslintConfig;
