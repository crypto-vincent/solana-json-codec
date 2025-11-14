import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  splitting: false,
  sourcemap: false,
  clean: true,
  platform: "node",
  target: "node18",
  outDir: "dist",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
