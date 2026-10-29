import { defineConfig } from "tsup";

export default defineConfig({
  entry: { receipts: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // One self-contained file keeps `npx github:...` installs fast and predictable.
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
});
