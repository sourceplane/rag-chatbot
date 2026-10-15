// eslint-config-next 16 ships flat configs; the template's `.eslintrc.json`
// (`extends: next/core-web-vitals`, run through `next lint`) has no Next 16
// equivalent — `next lint` is gone — so this is what `create-next-app` writes
// for Next 16, and the `lint` script is `eslint .`.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The template's `useEffect(() => { if (messages.length > 0) setIsExpanded(true) })`
    // and the loading-state effect are the pattern this rule, new in
    // eslint-config-next 16, flags; the template is kept as written.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      // components/ui/input.tsx declares the shadcn `InputProps extends
      // React.InputHTMLAttributes<HTMLInputElement> {}`; the rule comes with
      // eslint-config-next 16's TypeScript config and the template is kept.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  globalIgnores([".next/**", ".open-next/**", "next-env.d.ts", "cloudflare-env.d.ts"]),
]);
