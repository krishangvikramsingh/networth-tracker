import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src/web"),
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, "dist/web"), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
  resolve: { alias: { "@shared": path.resolve(__dirname, "src/shared") } },
});
