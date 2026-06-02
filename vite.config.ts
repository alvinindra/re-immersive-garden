import { defineConfig } from "vite";
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
});
