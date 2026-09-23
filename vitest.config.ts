import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        miniflare: {
          r2Buckets: ["BUCKET"],
          kvNamespaces: ["SHORT_LINKS"],
          bindings: { AUTH_TOKEN: "test-token" },
        },
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
