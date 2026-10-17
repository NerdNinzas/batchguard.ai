import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  { files: ["src/components/Scene.tsx"], rules: { "react-hooks/refs": "off", "react-hooks/purity": "off", "react-hooks/immutability": "off" } },
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
]);
