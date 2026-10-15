import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

// The page's Open Graph image link is absolute, resolved against the layout's
// `metadataBase`. Upstream hard-coded its own demo
// (https://ai-sdk-preview-rag.vercel.app), so every copy would advertise
// upstream's image URL. Here the origin is NEXT_PUBLIC_SITE_URL, which the
// deploy's build sets to the environment's own Worker URL (component.yaml).
const app = path.resolve(__dirname, "../../../apps/web");

describe("the page's public origin (app/(preview)/layout.tsx)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is NEXT_PUBLIC_SITE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://acme-rag-web-stage.acme.workers.dev");
    const { metadata } = await import("@/app/(preview)/layout");
    expect(String(metadata.metadataBase)).toBe("https://acme-rag-web-stage.acme.workers.dev/");
  });

  it("is localhost without it, and never upstream's demo", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined as unknown as string);
    const { metadata } = await import("@/app/(preview)/layout");
    expect(String(metadata.metadataBase)).toBe("http://localhost:3000/");
    expect(readFileSync(path.join(app, "app/(preview)/layout.tsx"), "utf8")).not.toMatch(/vercel\.app/);
  });

  it("is set by the deploy's build to this environment's Worker URL", () => {
    // Read off component.yaml itself — the worker name and subdomain are the
    // product's, whatever it is called.
    const component = readFileSync(path.join(app, "component.yaml"), "utf8");
    const workerName = /^\s*workerName:\s*(\S+)\s*$/m.exec(component)?.[1];
    const subdomain = /^\s*workersDevSubdomain:\s*(\S+)\s*$/m.exec(component)?.[1];
    expect(workerName && subdomain).toBeTruthy();
    const build = /^\s*buildCommand:\s*(.+)$/m.exec(component)?.[1] ?? "";
    expect(build).toContain(
      `NEXT_PUBLIC_SITE_URL="\${SITE_URL:-https://${workerName}-\${ORUN_ENVIRONMENT}.${subdomain}.workers.dev}" pnpm exec turbo run build`,
    );
  });
});
