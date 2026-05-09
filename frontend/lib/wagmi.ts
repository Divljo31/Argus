import { http, createConfig } from "wagmi";
import { base, mainnet } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { PUBLIC_ENV } from "./env";

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  connectors: [injected(), coinbaseWallet({ appName: "Argus" })],
  transports: {
    [base.id]: http(PUBLIC_ENV.baseRpc),
    [mainnet.id]: http(PUBLIC_ENV.mainnetRpc),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
