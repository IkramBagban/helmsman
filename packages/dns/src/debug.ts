import {
  resolve4,
  resolve6,
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
} from "node:dns/promises";
import { toAbsoluteHost } from "./utils.js";
import type { DnsRecord, RecordType } from "./types.js";

export interface PublicDnsInspection {
  readonly fqdn: string;
  readonly records: readonly DnsRecord[];
}

export interface DnsDebugResult {
  readonly fqdn: string;
  readonly authoritative: readonly DnsRecord[];
  readonly publicResolution: {
    readonly a: readonly string[];
    readonly aaaa: readonly string[];
    readonly cname: readonly string[];
    readonly mx: readonly string[];
    readonly ns: readonly string[];
    readonly txt: readonly string[];
  };
  readonly warnings: readonly string[];
}

const safeResolve = async <T>(
  resolver: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await resolver();
  } catch {
    return fallback;
  }
};

const toRecord = (
  host: string,
  type: RecordType,
  value: string,
  ttl: number,
  mxPref?: number,
): DnsRecord => ({
  host,
  type,
  value,
  ttl,
  mxPref,
});

export const inspectPublicDns = async (
  domain: string,
  host: string,
): Promise<PublicDnsInspection> => {
  const fqdn = toAbsoluteHost(host, domain);

  const [a, aaaa, cname, mxRaw, txtRaw] = await Promise.all([
    safeResolve(() => resolve4(fqdn), [] as string[]),
    safeResolve(() => resolve6(fqdn), [] as string[]),
    safeResolve(() => resolveCname(fqdn), [] as string[]),
    safeResolve(
      () => resolveMx(fqdn),
      [] as { priority: number; exchange: string }[],
    ),
    safeResolve(() => resolveTxt(fqdn), [] as string[][]),
  ]);

  const records: DnsRecord[] = [
    ...a.map((value) => toRecord(host, "A", value, 300)),
    ...aaaa.map((value) => toRecord(host, "AAAA", value, 300)),
    ...cname.map((value) => toRecord(host, "CNAME", value, 300)),
    ...mxRaw.map((value) =>
      toRecord(host, "MX", value.exchange, 300, value.priority),
    ),
    ...txtRaw.map((value) => toRecord(host, "TXT", value.join(""), 300)),
  ];

  return { fqdn, records };
};

export const debugDns = async (
  domain: string,
  host: string,
  authoritative: readonly DnsRecord[],
): Promise<DnsDebugResult> => {
  const fqdn = toAbsoluteHost(host, domain);

  const [a, aaaa, cname, mxRaw, ns, txtRaw] = await Promise.all([
    safeResolve(() => resolve4(fqdn), [] as string[]),
    safeResolve(() => resolve6(fqdn), [] as string[]),
    safeResolve(() => resolveCname(fqdn), [] as string[]),
    safeResolve(
      () => resolveMx(fqdn),
      [] as { priority: number; exchange: string }[],
    ),
    safeResolve(() => resolveNs(domain), [] as string[]),
    safeResolve(() => resolveTxt(fqdn), [] as string[][]),
  ]);

  const publicMx = mxRaw.map((item) => `${item.priority} ${item.exchange}`);
  const publicTxt = txtRaw.map((item) => item.join(""));

  const warnings: string[] = [];
  if (authoritative.length === 0) {
    warnings.push("No authoritative records found for host in provider.");
  }

  if (
    publicResolutionEmpty({
      a,
      aaaa,
      cname,
      mx: publicMx,
      ns,
      txt: publicTxt,
    })
  ) {
    warnings.push(
      "Public resolvers are not returning records yet. Check propagation / delegation.",
    );
  }

  return {
    fqdn,
    authoritative,
    publicResolution: {
      a,
      aaaa,
      cname,
      mx: publicMx,
      ns,
      txt: publicTxt,
    },
    warnings,
  };
};

const publicResolutionEmpty = (input: {
  a: readonly string[];
  aaaa: readonly string[];
  cname: readonly string[];
  mx: readonly string[];
  ns: readonly string[];
  txt: readonly string[];
}): boolean =>
  input.a.length === 0 &&
  input.aaaa.length === 0 &&
  input.cname.length === 0 &&
  input.mx.length === 0 &&
  input.ns.length === 0 &&
  input.txt.length === 0;
