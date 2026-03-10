export interface DnsRecord {
  readonly host: string;
  readonly type: string;
  readonly value: string;
  readonly ttl: number;
  readonly mxPref?: number;
}

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
