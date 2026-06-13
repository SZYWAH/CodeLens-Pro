import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "vendor-three";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "vendor-charts";
          if (id.includes("node_modules/@monaco-editor") || id.includes("node_modules/monaco-editor")) return "vendor-monaco";
          if (id.includes("node_modules/react-markdown") || id.includes("node_modules/remark-") || id.includes("node_modules/micromark")) {
            return "vendor-markdown";
          }
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true
      }
    }
  }
});
