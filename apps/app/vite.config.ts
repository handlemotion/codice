import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dashboard is the edge's default target, so its assets and server functions keep their
// default paths; only `/_site/*` and the API's prefixes are taken.
export default defineConfig({
  plugins: [
    cloudflare({ inspectorPort: false, viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
