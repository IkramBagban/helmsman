import { AppError } from "@helmsman/shared";
import type { DnsProvider } from "./providers/base-provider.js";
import { CloudflareDnsProvider } from "./providers/cloudflare/provider.js";
import { NamecheapDnsProvider } from "./providers/namecheap/provider.js";
import type { CloudflareConfig, NamecheapConfig } from "./types.js";

export type DnsProviderConfig =
  | {
      readonly provider: "namecheap";
      readonly namecheap: NamecheapConfig;
    }
  | {
      readonly provider: "cloudflare";
      readonly cloudflare: CloudflareConfig;
    };

export const createDnsProvider = (config: DnsProviderConfig): DnsProvider => {
  if (config.provider === "namecheap") {
    return new NamecheapDnsProvider(config.namecheap);
  }

  if (config.provider === "cloudflare") {
    return new CloudflareDnsProvider(config.cloudflare);
  }

  throw new AppError(
    "DNS_PROVIDER_UNSUPPORTED",
    "Unsupported DNS provider configured.",
    { provider: (config as { provider: string }).provider },
  );
};
