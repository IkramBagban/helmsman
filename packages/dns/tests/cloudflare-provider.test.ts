import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { CloudflareDnsProvider } from "../src/providers/cloudflare/provider.js";

const originalFetch = globalThis.fetch;

describe("CloudflareDnsProvider", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should list records and map host labels", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        success: true,
        result: [
          {
            id: "rec-1",
            name: "example.com",
            type: "A",
            content: "1.2.3.4",
            ttl: 300,
          },
          {
            id: "rec-2",
            name: "api.example.com",
            type: "CNAME",
            content: "target.example.net",
            ttl: 120,
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const provider = new CloudflareDnsProvider({
      apiToken: "token",
      zoneMap: { "example.com": "zone-123" },
    });

    const records = await provider.listRecords("example.com");
    expect(records).toEqual([
      {
        id: "rec-1",
        host: "@",
        type: "A",
        value: "1.2.3.4",
        ttl: 300,
        mxPref: undefined,
      },
      {
        id: "rec-2",
        host: "api",
        type: "CNAME",
        value: "target.example.net",
        ttl: 120,
        mxPref: undefined,
      },
    ]);
  });

  it("should discover zone and create record", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: init?.body as string | undefined,
        });

        if (url.includes("/zones?name=example.com")) {
          return Response.json({
            success: true,
            result: [{ id: "zone-abc", name: "example.com" }],
          });
        }

        return Response.json({
          success: true,
          result: {
            id: "rec-5",
            name: "api.example.com",
            type: "A",
            content: "10.0.0.5",
            ttl: 300,
          },
        });
      },
    ) as unknown as typeof fetch;

    const provider = new CloudflareDnsProvider({ apiToken: "token" });
    const created = await provider.createRecord("example.com", {
      host: "api",
      type: "A",
      value: "10.0.0.5",
      ttl: 300,
    });

    expect(created).toEqual({
      id: "rec-5",
      host: "api",
      type: "A",
      value: "10.0.0.5",
      ttl: 300,
      mxPref: undefined,
    });

    expect(calls[0]?.url).toContain("/zones?name=example.com");
    expect(calls[1]?.url).toContain("/zones/zone-abc/dns_records");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.body).toContain('"name":"api.example.com"');
  });
});
