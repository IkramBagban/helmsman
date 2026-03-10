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
  DnsRecord,
  NamecheapConfig,
  RecordType,
  DomainAvailabilityResult,
  DomainPricingResult,
} from "./types.js";
