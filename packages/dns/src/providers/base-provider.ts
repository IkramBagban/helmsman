import type {
  DnsRecord,
  DomainAvailabilityResult,
  DomainPricingResult,
} from "../types.js";

export interface DnsProvider {
  listRecords(domain: string): Promise<readonly DnsRecord[]>;
  getRecord(domain: string, recordId: string): Promise<DnsRecord>;
  createRecord(
    domain: string,
    record: Omit<DnsRecord, "id">,
  ): Promise<DnsRecord>;
  updateRecord(
    domain: string,
    recordId: string,
    patch: Partial<Omit<DnsRecord, "id">>,
  ): Promise<DnsRecord>;
  deleteRecord(domain: string, recordId: string): Promise<void>;

  checkDomainAvailability?(domain: string): Promise<DomainAvailabilityResult>;
  getDomainPricing?(tld: string): Promise<DomainPricingResult>;
}
