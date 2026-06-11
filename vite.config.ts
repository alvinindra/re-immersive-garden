import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import glsl from "vite-plugin-glsl";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    glsl({
      warnDuplicatedImports: false,
    }),
  ],
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      input: {
        // homepage (the relief + gallery experience)
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        // /learn — the WebGL + three.js explainer (a second MPA entry)
        learn: fileURLToPath(new URL("./learn/index.html", import.meta.url)),
      },
    },
  },
});
