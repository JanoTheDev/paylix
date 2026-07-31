import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // apps/web/Dockerfile's runner stage copies `.next/standalone`; without this
  // Next never emits that directory and the image build fails on COPY.
  output: "standalone",
  // In a monorepo Next has to be told where the workspace root is, otherwise
  // file tracing starts at apps/web and the standalone bundle misses the
  // hoisted node_modules at the repo root.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@paylix/db"],
  webpack: (config, { webpack }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @wagmi/connectors statically imports several optional peer deps
    // (porto, @coinbase/wallet-sdk, @metamask/connect-evm) for connectors
    // we don't use. None are installed. Ignore them at compile time so
    // webpack never tries to resolve or evaluate them.
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(porto(\/.*)?|@coinbase\/wallet-sdk|@metamask\/connect-evm)$/,
      }),
    );
    return config;
  },
};

export default nextConfig;
