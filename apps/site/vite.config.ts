import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

// The edge Worker shares `codice.io` with the dashboard, so everything the site serves that is not
// a page lives under `/_site/` (assets and server functions) to keep routing a prefix.
export default defineConfig({
  build: { assetsDir: "_site" },
  plugins: [
    fumadocsMdx(),
    cloudflare({ inspectorPort: false, viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({ serverFns: { base: "/_site/fn" } }),
    viteReact(),
  ],
});
