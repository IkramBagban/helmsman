export interface DnsRecord {
  readonly id?: string;
  readonly host: string;
  readonly type: RecordType;
  readonly value: string;
  readonly ttl: number;
  readonly mxPref?: number;
}

export type RecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "MX"
  | "TXT"
  | "NS"
  | "SRV"
  | "CAA";

export interface DomainSplit {
  readonly sld: string;
  readonly tld: string;
}

export interface NamecheapConfig {
  readonly apiUser: string;
  readonly apiKey: string;
  readonly username: string;
  readonly clientIp: string;
  readonly apiBaseUrl?: string;
}

export interface DomainAvailabilityResult {
  readonly domain: string;
  readonly available: boolean;
  readonly source: "namecheap";
  readonly isPremium?: boolean;
  readonly premiumRegistrationPrice?: number;
  readonly premiumRenewalPrice?: number;
  readonly premiumRestorePrice?: number;
  readonly icannFee?: number;
  readonly eapFee?: number;
  readonly message?: string;
}

export interface DomainPricingResult {
  readonly tld: string;
  readonly source: "namecheap";
  readonly currency?: string;
  readonly registration?: number;
  readonly renewal?: number;
  readonly transfer?: number;
  readonly restore?: number;
  readonly note?: string;
}
