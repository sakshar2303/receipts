import { defineConfig } from "tsup";

// The eval scripts are TypeScript like the rest of the code; they are built to
// .receipts/ (ignored by git) and run with Node. They never ship in the package.
export default defineConfig({
  entry: { run: "eval/run.ts", label: "eval/label.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: ".receipts/eval-build",
  clean: true,
  removeNodeProtocol: false,
  shims: true,
});
