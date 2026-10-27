import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The edge Worker shares `codice.io` with the dashboard, so everything the site serves that is not
// a page lives under `/_site/` (assets and server functions) to keep routing a prefix.
export default defineConfig({
  build: { assetsDir: "_site" },
  // In development the ask box searches the local API Worker (`pnpm dev:up`); in production the
  // edge sends `/v1` on the same host to it.
  server: {
    proxy: {
      "/v1": { target: "https://codice.local.transitive.app", changeOrigin: true, secure: false },
    },
  },
  plugins: [
    cloudflare({ inspectorPort: false, viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({ serverFns: { base: "/_site/fn" } }),
    viteReact(),
  ],
});
