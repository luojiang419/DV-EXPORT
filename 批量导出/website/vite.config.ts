import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "website",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../build/website",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sponsors: resolve(__dirname, "sponsors.html"),
        sponsorsAdmin: resolve(__dirname, "sponsors-admin.html")
      }
    }
  }
});
