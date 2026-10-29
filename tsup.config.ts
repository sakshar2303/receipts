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
  // node:sqlite only exists under its node: name; stripping the prefix breaks it.
  removeNodeProtocol: false,
  banner: { js: "#!/usr/bin/env node" },
});
