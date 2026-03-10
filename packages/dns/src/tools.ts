import { AppError, type ProviderPackage } from "@helmsman/shared";
import { createTool } from "@mastra/core/tools";
import { Resolver } from "node:dns/promises";
import { z } from "zod";
import { debugDns, inspectPublicDns } from "./debug.js";
import { checkDomainAvailability, getDomainDetails } from "./public-domain.js";
import {
  createDnsProvider,
  type DnsProviderConfig,
} from "./provider-resolver.js";
import type { DnsRecord, RecordType } from "./types.js";

const recordTypeSchema = z.enum([
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SRV",
  "CAA",
]);

const recordSchema = z.object({
  host: z.string().min(1).describe("Host label, e.g. @, www, api"),
  type: recordTypeSchema,
  value: z.string().min(1).describe("Record value"),
  ttl: z.number().int().min(60).max(86400).default(300),
  mxPref: z.number().int().min(0).max(65535).optional(),
});

const recordPatchSchema = z.object({
  host: z.string().min(1).optional(),
  type: recordTypeSchema.optional(),
  value: z.string().min(1).optional(),
  ttl: z.number().int().min(60).max(86400).optional(),
  mxPref: z.number().int().min(0).max(65535).optional(),
});

const PUBLIC_RESOLVERS: ReadonlyArray<{ name: string; ip: string }> = [
  { name: "Google", ip: "8.8.8.8" },
  { name: "Cloudflare", ip: "1.1.1.1" },
  { name: "OpenDNS", ip: "208.67.222.222" },
  { name: "Quad9", ip: "9.9.9.9" },
];

const normalizeRecord = (
  record: Omit<DnsRecord, "id">,
): Omit<DnsRecord, "id"> => ({
  ...record,
  host: record.host.trim(),
  type: record.type.toUpperCase() as RecordType,
  value: record.value.trim(),
});

const validateRecord = (record: Partial<Omit<DnsRecord, "id">>): void => {
  if (record.type === "MX" && record.mxPref === undefined) {
    throw new AppError("DNS_RECORD_INVALID", "MX records require mxPref.", {
      record,
    });
  }

  if (record.type === "A" && record.value) {
    const ipv4 =
      /^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/;
    if (!ipv4.test(record.value)) {
      throw new AppError(
        "DNS_RECORD_INVALID",
        "A records require a valid IPv4 address value.",
        {
          value: record.value,
        },
      );
    }
  }

  if (record.type === "CNAME" && record.host === "@") {
    throw new AppError(
      "DNS_RECORD_INVALID",
      "CNAME at apex (@) is not allowed in this tool. Use A/AAAA/ALIAS-compatible setup.",
      { record },
    );
  }
};

const normalizeHost = (host: string): string => host.trim().toLowerCase();

const recordMatches = (
  record: DnsRecord,
  host: string,
  type?: RecordType,
): boolean => {
  const hostMatch = normalizeHost(record.host) === normalizeHost(host);
  const typeMatch = !type || record.type === type;
  return hostMatch && typeMatch;
};

const resolveRecords = async (
  resolver: Resolver,
  domain: string,
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS",
): Promise<readonly string[]> => {
  switch (type) {
    case "A":
      return await resolver.resolve4(domain);
    case "AAAA":
      return await resolver.resolve6(domain);
    case "CNAME":
      return await resolver.resolveCname(domain);
    case "MX":
      return (await resolver.resolveMx(domain)).map(
        (record) => `${record.priority} ${record.exchange}`,
      );
    case "TXT":
      return (await resolver.resolveTxt(domain)).flat();
    case "NS":
      return await resolver.resolveNs(domain);
  }
};

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
      type: recordTypeSchema.optional(),
    }),
    execute: async ({ domain, host, type }) => {
      if (provider) {
        const records = (await provider.listRecords(domain)).filter((record) =>
          recordMatches(record, host, type),
        );

        return {
          domain,
          source: "provider",
          host,
          type,
          count: records.length,
          records,
        };
      }

      const publicData = await inspectPublicDns(domain, host);
      const filtered = type
        ? publicData.records.filter((record) => record.type === type)
        : publicData.records;

      return {
        domain,
        source: "public_resolver",
        fqdn: publicData.fqdn,
        host,
        type,
        count: filtered.length,
        records: filtered,
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
        ? (await provider.listRecords(domain)).filter((record) =>
            recordMatches(record, host),
          )
        : [];

      const result = await debugDns(domain, host, authoritative);
      return {
        ...result,
        providerConfigured: Boolean(provider),
      };
    },
  });

  const dnsPropagationTool = createTool({
    id: "dns_check_propagation",
    description:
      "Check if a DNS record has propagated across Google, Cloudflare, OpenDNS, and Quad9 resolvers.",
    inputSchema: z.object({
      domain: z.string().min(3),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]),
      expectedValue: z.string().optional(),
    }),
    execute: async ({ domain, type, expectedValue }) => {
      const checks = await Promise.allSettled(
        PUBLIC_RESOLVERS.map(async (server) => {
          const resolver = new Resolver();
          resolver.setServers([server.ip]);
          const records = await resolveRecords(resolver, domain, type);

          const propagated = expectedValue
            ? records.some((value) => value.includes(expectedValue))
            : records.length > 0;

          return {
            resolver: server.name,
            ip: server.ip,
            records,
            propagated,
          };
        }),
      );

      const results = checks.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        }

        return {
          resolver: PUBLIC_RESOLVERS[index]?.name ?? "unknown",
          ip: PUBLIC_RESOLVERS[index]?.ip,
          records: [] as readonly string[],
          propagated: false,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        };
      });

      const propagatedCount = results.filter((item) => item.propagated).length;
      return {
        domain,
        type,
        expectedValue,
        propagated: propagatedCount === PUBLIC_RESOLVERS.length,
        summary: `${propagatedCount}/${PUBLIC_RESOLVERS.length} resolvers returned the expected result`,
        resolvers: results,
      };
    },
  });

  const dnsEmailHealthTool = createTool({
    id: "dns_check_email_health",
    description:
      "Check SPF, DKIM, and DMARC records for a domain using public DNS.",
    inputSchema: z.object({
      domain: z.string().min(3),
      dkimSelector: z.string().optional(),
    }),
    execute: async ({ domain, dkimSelector }) => {
      const resolver = new Resolver();

      const [spfRaw, dmarcRaw, dkimRaw] = await Promise.allSettled([
        resolver.resolveTxt(domain),
        resolver.resolveTxt(`_dmarc.${domain}`),
        dkimSelector
          ? resolver.resolveTxt(`${dkimSelector}._domainkey.${domain}`)
          : Promise.resolve([] as string[][]),
      ]);

      const spfRecords =
        spfRaw.status === "fulfilled"
          ? spfRaw.value
              .flat()
              .filter((record) => record.toLowerCase().startsWith("v=spf1"))
          : [];

      const dmarcRecords =
        dmarcRaw.status === "fulfilled"
          ? dmarcRaw.value
              .flat()
              .filter((record) => record.toUpperCase().startsWith("V=DMARC1"))
          : [];

      const dkimRecords =
        dkimRaw.status === "fulfilled" ? dkimRaw.value.flat() : [];

      return {
        domain,
        spf: {
          found: spfRecords.length > 0,
          records: spfRecords,
          warning:
            spfRecords.length > 1
              ? "Multiple SPF records detected. Only one SPF TXT record should exist."
              : undefined,
        },
        dmarc: {
          found: dmarcRecords.length > 0,
          records: dmarcRecords,
        },
        dkim: dkimSelector
          ? {
              selector: dkimSelector,
              found: dkimRecords.length > 0,
              records: dkimRecords,
            }
          : {
              skipped: true,
            },
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
      "Check whether a domain appears available. Uses provider API when configured, otherwise RDAP heuristic.",
    inputSchema: z.object({ domain: z.string().min(3) }),
    execute: async ({ domain }) => {
      if (provider?.checkDomainAvailability) {
        return {
          lookupMode: "provider",
          provider: "namecheap",
          ...(await provider.checkDomainAvailability(domain)),
        };
      }

      return {
        lookupMode: "rdap_fallback",
        ...(await checkDomainAvailability(domain)),
      };
    },
  });

  const dnsCheckPricingTool = createTool({
    id: "dns_check_domain_pricing",
    description:
      "Check domain pricing for a TLD through provider API. Requires Namecheap credentials.",
    inputSchema: z.object({
      tld: z.string().min(2).describe("TLD like com, io, ai, app"),
    }),
    execute: async ({ tld }) => {
      if (!provider?.getDomainPricing) {
        return {
          ok: false,
          error:
            "Provider credentials are not configured. Set DNS_PROVIDER to cloudflare or namecheap with matching provider credentials to check live pricing.",
        };
      }

      return {
        ok: true,
        ...(await provider.getDomainPricing(tld)),
      };
    },
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
            "Provider credentials are not configured. Set DNS_PROVIDER to cloudflare or namecheap with matching provider credentials to perform write operations.",
        };
      }

      validateRecord(record);
      const created = await provider.createRecord(
        domain,
        normalizeRecord(record),
      );

      return { ok: true, domain, created };
    },
  });

  const dnsUpdateTool = createTool({
    id: "dns_update_record",
    description:
      "Update an existing DNS record by recordId from dns_inspect_records (provider mode).",
    inputSchema: z.object({
      domain: z.string().min(3),
      recordId: z.string().min(1),
      patch: recordPatchSchema,
    }),
    execute: async ({ domain, recordId, patch }) => {
      if (!provider) {
        return {
          ok: false,
          error:
            "Provider credentials are not configured. Set DNS_PROVIDER to cloudflare or namecheap with matching provider credentials to perform write operations.",
        };
      }

      validateRecord(patch);

      const normalizedPatch = {
        ...patch,
        type: patch.type?.toUpperCase() as RecordType | undefined,
      };

      const updated = await provider.updateRecord(
        domain,
        recordId,
        normalizedPatch,
      );
      return { ok: true, domain, updated };
    },
  });

  const dnsDeleteTool = createTool({
    id: "dns_delete_record",
    description:
      "Delete a DNS record by recordId from dns_inspect_records (provider mode).",
    inputSchema: z.object({
      domain: z.string().min(3),
      recordId: z.string().min(1),
    }),
    execute: async ({ domain, recordId }) => {
      if (!provider) {
        return {
          ok: false,
          error:
            "Provider credentials are not configured. Set DNS_PROVIDER to cloudflare or namecheap with matching provider credentials to perform write operations.",
        };
      }

      await provider.deleteRecord(domain, recordId);
      return { ok: true, domain, deletedRecordId: recordId };
    },
  });

  return {
    name: "dns",
    displayName: "DNS & Domains",
    observerTools: [
      dnsInspectTool,
      dnsDebugTool,
      dnsPropagationTool,
      dnsEmailHealthTool,
      dnsDomainDetailsTool,
      dnsCheckAvailabilityTool,
      dnsCheckPricingTool,
    ],
    operatorTools: [dnsCreateTool, dnsUpdateTool],
    commanderTools: [dnsDeleteTool],
  };
};
