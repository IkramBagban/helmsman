import type { ProviderPackage } from "@helmsman/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { debugDns, inspectPublicDns } from "./debug.js";
import { checkDomainAvailability, getDomainDetails } from "./public-domain.js";
import {
  createDnsProvider,
  type DnsProviderConfig,
} from "./provider-resolver.js";
import type { DnsRecord } from "./types.js";

const recordSchema = z.object({
  host: z.string().min(1).describe("Host label, e.g. @, www, api"),
  type: z
    .string()
    .min(1)
    .describe("DNS record type: A, AAAA, CNAME, TXT, MX, NS..."),
  value: z.string().min(1).describe("Record value"),
  ttl: z.number().int().min(60).max(86400).default(300),
  mxPref: z.number().int().min(0).max(65535).optional(),
});

const normalizeRecord = (record: DnsRecord): DnsRecord => ({
  ...record,
  type: record.type.toUpperCase(),
});

export interface DnsToolsConfig {
  readonly providerConfig?: DnsProviderConfig;
}

export const createDnsProviderPackage = (
  config: DnsToolsConfig,
): ProviderPackage => {
  const provider = config.providerConfig
    ? createDnsProvider(config.providerConfig)
    : undefined;

  const dnsInspectTool = createTool({
    id: "dns_inspect_records",
    description:
      "Inspect DNS records. Uses configured provider when available, otherwise falls back to public DNS resolvers.",
    inputSchema: z.object({
      domain: z.string().min(3),
      host: z.string().min(1).default("@"),
    }),
    execute: async ({ domain, host }) => {
      if (provider) {
        const records = await provider.listRecords(domain);
        return { domain, source: "provider", count: records.length, records };
      }

      const publicData = await inspectPublicDns(domain, host);
      return {
        domain,
        source: "public_resolver",
        fqdn: publicData.fqdn,
        count: publicData.records.length,
        records: publicData.records,
      };
    },
  });

  const dnsDebugTool = createTool({
    id: "dns_debug_resolution",
    description:
      "Debug DNS resolution by comparing provider records (if configured) with public resolver results.",
    inputSchema: z.object({
      domain: z.string().min(3),
      host: z.string().min(1).default("@"),
    }),
    execute: async ({ domain, host }) => {
      const authoritative = provider
        ? (await provider.listRecords(domain)).filter(
            (record) => record.host.toLowerCase() === host.toLowerCase(),
          )
        : [];

      const result = await debugDns(domain, host, authoritative);
      return {
        ...result,
        providerConfigured: Boolean(provider),
      };
    },
  });

  const dnsDomainDetailsTool = createTool({
    id: "dns_domain_details",
    description:
      "Get domain registration details (registrar, nameservers, status, dates) using RDAP.",
    inputSchema: z.object({ domain: z.string().min(3) }),
    execute: async ({ domain }) => await getDomainDetails(domain),
  });

  const dnsCheckAvailabilityTool = createTool({
    id: "dns_check_domain_availability",
    description:
      "Check whether a domain appears available using public RDAP data.",
    inputSchema: z.object({ domain: z.string().min(3) }),
    execute: async ({ domain }) => await checkDomainAvailability(domain),
  });

  const dnsCreateTool = createTool({
    id: "dns_create_record",
    description:
      "Create a DNS record in the configured provider. Requires provider credentials.",
    inputSchema: z.object({ domain: z.string().min(3), record: recordSchema }),
    execute: async ({ domain, record }) => {
      if (!provider) {
        return {
          ok: false,
          error:
            "Provider credentials are not configured. Set DNS_PROVIDER=namecheap and Namecheap credentials to perform write operations.",
        };
      }

      const next = await provider.createRecord(domain, normalizeRecord(record));
      return { ok: true, domain, updatedCount: next.length, records: next };
    },
  });

  const dnsUpdateTool = createTool({
    id: "dns_update_record",
    description:
      "Update an existing DNS record by host + type in the configured provider.",
    inputSchema: z.object({ domain: z.string().min(3), record: recordSchema }),
    execute: async ({ domain, record }) => {
      if (!provider) {
        return {
          ok: false,
          error:
            "Provider credentials are not configured. Set DNS_PROVIDER=namecheap and Namecheap credentials to perform write operations.",
        };
      }

      const next = await provider.updateRecord(domain, normalizeRecord(record));
      return { ok: true, domain, updatedCount: next.length, records: next };
    },
  });

  const dnsDeleteTool = createTool({
    id: "dns_delete_record",
    description:
      "Delete a DNS record by host + type in the configured provider.",
    inputSchema: z.object({
      domain: z.string().min(3),
      host: z.string().min(1),
      type: z.string().min(1),
    }),
    execute: async ({ domain, host, type }) => {
      if (!provider) {
        return {
          ok: false,
          error:
            "Provider credentials are not configured. Set DNS_PROVIDER=namecheap and Namecheap credentials to perform write operations.",
        };
      }

      const next = await provider.deleteRecord(domain, {
        host,
        type: type.toUpperCase(),
      });
      return { ok: true, domain, updatedCount: next.length, records: next };
    },
  });

  return {
    name: "dns",
    displayName: "DNS & Domains",
    observerTools: [
      dnsInspectTool,
      dnsDebugTool,
      dnsDomainDetailsTool,
      dnsCheckAvailabilityTool,
    ],
    operatorTools: [dnsCreateTool, dnsUpdateTool],
    commanderTools: [dnsDeleteTool],
  };
};
