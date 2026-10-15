// OpenNext Cloudflare adapter config.
//
// The chat page is a client component with no server data, so `next build`
// pre-renders its shell once; the chat route (`app/(preview)/api/chat`) is
// dynamic and streams. Nothing uses `"use cache"`, `cacheTag` or
// `revalidateTag`, so the static-assets incremental cache — the pre-rendered
// shell served straight from the Worker's static assets, populated by
// `populateCache local` in the build script, read only, nothing to provision —
// is the whole cache. A template that revalidates swaps this for the R2
// incremental cache plus a tag cache.
import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
