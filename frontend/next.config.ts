import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@argus/shared"],
  // Shared package uses NodeNext-style `.js` extensions in re-exports so the
  // agents (Node ESM) work. Webpack reads those literally and 404s on actual
  // `.ts` files; this alias makes both worlds coexist.
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  env: {
    NEXT_PUBLIC_VAULT_ADDRESS: process.env.VAULT_ADDRESS_BASE,
    NEXT_PUBLIC_MANAGER_ENS: process.env.MANAGER_ENS,
    NEXT_PUBLIC_WATCHER_ENS: process.env.WATCHER_ENS,
    NEXT_PUBLIC_MANAGER_HTTP_URL: process.env.MANAGER_HTTP_URL ?? "http://localhost:4001",
    NEXT_PUBLIC_BASE_RPC_URL: process.env.BASE_RPC_URL,
    NEXT_PUBLIC_MAINNET_RPC_URL: process.env.MAINNET_RPC_URL,
  },
};

export default config;
