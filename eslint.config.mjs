import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts", "src/app/jsxgraph.css"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
