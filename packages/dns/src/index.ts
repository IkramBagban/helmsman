export { createDnsProviderPackage, type DnsToolsConfig } from "./tools.js";
export {
  createDnsProvider,
  type DnsProviderConfig,
} from "./provider-resolver.js";
export {
  checkDomainAvailability,
  getDomainDetails,
  type DomainAvailabilityResult,
  type DomainDetailsResult,
} from "./public-domain.js";
export type { DnsRecord, NamecheapConfig } from "./types.js";
