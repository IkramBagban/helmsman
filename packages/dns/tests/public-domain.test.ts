import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  checkDomainAvailability,
  getDomainDetails,
} from "../src/public-domain.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getDomainDetails", () => {
  it("should return not_found when rdap returns 404", async () => {
    globalThis.fetch = mock(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;

    const result = await getDomainDetails("notfound-example-123.com");
    expect(result.status).toBe("not_found");
    expect(result.nameservers).toEqual([]);
  });

  it("should parse registrar and events for registered domain", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        status: ["active"],
        nameservers: [{ ldhName: "ns1.example.com" }],
        events: [
          { eventAction: "registration", eventDate: "2024-01-01T00:00:00Z" },
          { eventAction: "expiration", eventDate: "2027-01-01T00:00:00Z" },
        ],
        entities: [
          {
            roles: ["registrar"],
            vcardArray: ["vcard", [["fn", {}, "text", "Namecheap, Inc."]]],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await getDomainDetails("example.com");
    expect(result.status).toBe("registered");
    expect(result.registrar).toBe("Namecheap, Inc.");
    expect(result.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(result.expiresAt).toBe("2027-01-01T00:00:00Z");
  });
});

describe("checkDomainAvailability", () => {
  it("should mark not found rdap domains as likely available", async () => {
    globalThis.fetch = mock(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    const result = await checkDomainAvailability("notfound-example-123.com");
    expect(result.available).toBe(true);
    expect(result.confidence).toBe("medium");
  });
});
