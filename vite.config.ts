import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: "index.html",
    },
  },
});
