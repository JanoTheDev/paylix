import { defineConfig } from "tsup";

export default defineConfig({
  // `webhooks` gets its own entry so consumers can verify signatures
  // without pulling in the HTTP client.
  entry: ["src/index.ts", "src/webhooks.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The SDK has no runtime dependencies — nothing to mark external.
});
