// Vite config for the browser view. build-web.sh copies this directory into pob-web's workspace as
// packages/view so the driver and its dependencies resolve from pob-web's own lockfile.
// Mirrors packages/driver/vite.config.ts (aliases, defines, texture decoder copy, worker format).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "../..");
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set (run api/web/build-web.sh)`);
  return value;
};

export default defineConfig({
  root: here,
  base: "/",
  resolve: {
    alias: {
      "pob-driver": join(rootDir, "packages/driver/src/js"),
      dds: join(rootDir, "packages/dds/src/index.ts"),
      "pob-game": join(rootDir, "packages/game/src/index.ts"),
    },
  },
  define: {
    __BPTC_SUPPORT_OVERRIDE__: "undefined",
    __MAX_RENDERING_DIMENSION_OVERRIDE__: "undefined",
    __POB_ASSETS__: JSON.stringify(`/pob/${env("POB_VERSION_ID")}`),
  },
  publicDir: join(rootDir, "packages/driver/public"), // fonts the driver loads from the site root
  build: {
    outDir: env("POB_WEB_OUT"),
    emptyOutDir: true,
    sourcemap: false,
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@bokuweb/zstd-wasm"] },
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [{ src: join(rootDir, "node_modules/texture2ddecoder-wasm/wasm/*"), dest: "texture2ddecoder" }],
    }),
  ],
});
