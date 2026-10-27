import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The edge Worker shares `codice.io` with the dashboard, so everything the site serves that is not
// a page lives under `/_site/` (assets and server functions) to keep routing a prefix.
export default defineConfig({
  build: { assetsDir: "_site" },
  // In production the edge sends `/v1` (the demo chat's `POST /v1/chat`) to the API; in `vite dev`
  // this proxy stands in for it, to the local API (`pnpm dev:up`) unless CODICE_API_ORIGIN says.
  server: {
    proxy: {
      "/v1": {
        target: process.env.CODICE_API_ORIGIN ?? "https://codice.local.transitive.app",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    cloudflare({ inspectorPort: false, viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({ serverFns: { base: "/_site/fn" } }),
    viteReact(),
  ],
});
