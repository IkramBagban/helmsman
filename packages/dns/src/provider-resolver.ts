import { AppError } from "@helmsman/shared";
import type { DnsProvider } from "./providers/base-provider.js";
import { NamecheapDnsProvider } from "./providers/namecheap/provider.js";
import type { NamecheapConfig } from "./types.js";

export interface DnsProviderConfig {
  readonly provider: "namecheap";
  readonly namecheap: NamecheapConfig;
}

export const createDnsProvider = (config: DnsProviderConfig): DnsProvider => {
  if (config.provider === "namecheap") {
    return new NamecheapDnsProvider(config.namecheap);
  }

  throw new AppError(
    "DNS_PROVIDER_UNSUPPORTED",
    "Unsupported DNS provider configured.",
    { provider: config.provider },
  );
};
