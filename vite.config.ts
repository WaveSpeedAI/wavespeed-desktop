import { resolve } from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Stub Capacitor modules for web/desktop build (they only run in Capacitor mobile)
const CAPACITOR_MODULES = [
  "@capacitor/core",
  "@capacitor/filesystem",
  "@capacitor/browser",
];
function stubCapacitorPlugin(): Plugin {
  return {
    name: "stub-capacitor",
    resolveId(id) {
      if (CAPACITOR_MODULES.includes(id)) return "\0" + id;
    },
    load(id) {
      if (id.startsWith("\0@capacitor/")) {
        return `
          export const CapacitorHttp = { get: async () => ({ status: 0, data: null }) };
          export const Filesystem = { mkdir: async () => {}, writeFile: async () => {} };
          export const Directory = { Documents: 'DOCUMENTS' };
          export const Browser = { open: async () => {} };
        `;
      }
    },
  };
}

export default defineConfig({
  plugins: [stubCapacitorPlugin(), react()],
  server: {
    port: 8989,
    host: "0.0.0.0",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es",
  },
  // Ensure WASM files are properly served
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
  build: {
    outDir: "dist-web",
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  base: "./",
});
