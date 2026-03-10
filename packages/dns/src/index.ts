export { createDnsProviderPackage, type DnsToolsConfig } from "./tools.js";
export {
  createDnsProvider,
  type DnsProviderConfig,
} from "./provider-resolver.js";
export {
  checkDomainAvailability,
  getDomainDetails,
  type DomainAvailabilityResult as PublicDomainAvailabilityResult,
  type DomainDetailsResult,
} from "./public-domain.js";
export type {
  CloudflareConfig,
  DnsRecord,
  DomainAvailabilityResult,
  DomainPricingResult,
  NamecheapConfig,
  RecordType,
} from "./types.js";
