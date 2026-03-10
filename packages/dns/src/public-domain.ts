import { AppError } from "@helmsman/shared";

export interface DomainAvailabilityResult {
  readonly domain: string;
  readonly available: boolean;
  readonly confidence: "high" | "medium";
  readonly source: string;
  readonly note: string;
}

export interface DomainDetailsResult {
  readonly domain: string;
  readonly status: "registered" | "not_found";
  readonly registrar?: string;
  readonly nameservers: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly rawStatus: readonly string[];
  readonly source: string;
}

interface RdapResponse {
  readonly ldhName?: string;
  readonly status?: readonly string[];
  readonly nameservers?: readonly { readonly ldhName?: string }[];
  readonly entities?: readonly {
    readonly roles?: readonly string[];
    readonly vcardArray?: readonly unknown[];
  }[];
  readonly events?: readonly {
    readonly eventAction?: string;
    readonly eventDate?: string;
  }[];
}

const RDAP_BASE_URL = "https://rdap.org/domain";

const extractRegistrar = (rdap: RdapResponse): string | undefined => {
  const registrarEntity = rdap.entities?.find((entity) =>
    entity.roles?.includes("registrar"),
  );

  const vcard = registrarEntity?.vcardArray;
  if (!Array.isArray(vcard) || !Array.isArray(vcard[1])) {
    return undefined;
  }

  const fullNameEntry = vcard[1].find(
    (entry): entry is readonly [string, unknown, unknown, string] =>
      Array.isArray(entry) &&
      entry.length >= 4 &&
      typeof entry[0] === "string" &&
      entry[0] === "fn" &&
      typeof entry[3] === "string",
  );

  return fullNameEntry?.[3];
};

const findEventDate = (
  rdap: RdapResponse,
  action: string,
): string | undefined =>
  rdap.events?.find((event) => event.eventAction === action)?.eventDate;

const fetchRdap = async (domain: string): Promise<RdapResponse | null> => {
  const response = await fetch(
    `${RDAP_BASE_URL}/${encodeURIComponent(domain)}`,
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new AppError("DNS_RDAP_LOOKUP_FAILED", "RDAP lookup failed.", {
      domain,
      status: response.status,
    });
  }

  return (await response.json()) as RdapResponse;
};

export const getDomainDetails = async (
  domain: string,
): Promise<DomainDetailsResult> => {
  const rdap = await fetchRdap(domain);

  if (!rdap) {
    return {
      domain,
      status: "not_found",
      nameservers: [],
      rawStatus: [],
      source: "rdap.org",
    };
  }

  return {
    domain,
    status: "registered",
    registrar: extractRegistrar(rdap),
    nameservers:
      rdap.nameservers
        ?.map((item) => item.ldhName)
        .filter((value): value is string => Boolean(value)) ?? [],
    createdAt: findEventDate(rdap, "registration"),
    expiresAt: findEventDate(rdap, "expiration"),
    rawStatus: rdap.status ?? [],
    source: "rdap.org",
  };
};

export const checkDomainAvailability = async (
  domain: string,
): Promise<DomainAvailabilityResult> => {
  const details = await getDomainDetails(domain);

  if (details.status === "not_found") {
    return {
      domain,
      available: true,
      confidence: "medium",
      source: "rdap.org",
      note: "Domain not found in RDAP; likely available, but verify with registrar pricing/availability API before purchase.",
    };
  }

  return {
    domain,
    available: false,
    confidence: "high",
    source: "rdap.org",
    note: "Domain is already registered.",
  };
};
