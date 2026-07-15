import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  resolve: mode === "preview" ? {
    alias: {
      "./api": fileURLToPath(new URL("./src/dev-preview/client.ts", import.meta.url)),
      "./showcaseMaterialLab": fileURLToPath(new URL("./src/dev-preview/ShowcaseMaterialLab.tsx", import.meta.url))
    }
  } : undefined,
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          "three-runtime": ["three"]
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  }
}));
