export const PUBLIC_ENV = {
  vaultAddress: (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "0x0") as `0x${string}`,
  managerEns: process.env.NEXT_PUBLIC_MANAGER_ENS ?? "manager.argus.divljo.eth",
  watcherEns: process.env.NEXT_PUBLIC_WATCHER_ENS ?? "watcher.argus.divljo.eth",
  managerUrl: process.env.NEXT_PUBLIC_MANAGER_HTTP_URL ?? "http://localhost:4001",
  baseRpc: process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org",
  mainnetRpc: process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "https://eth.llamarpc.com",
};
