import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  plugins: [
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
