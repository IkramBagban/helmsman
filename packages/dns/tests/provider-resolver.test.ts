import { describe, expect, it } from "bun:test";
import { createDnsProvider } from "../src/provider-resolver.js";

describe("createDnsProvider", () => {
  it("should create cloudflare provider", () => {
    const provider = createDnsProvider({
      provider: "cloudflare",
      cloudflare: {
        apiToken: "token",
      },
    });

    expect(typeof provider.listRecords).toBe("function");
    expect(typeof provider.createRecord).toBe("function");
  });

  it("should create namecheap provider", () => {
    const provider = createDnsProvider({
      provider: "namecheap",
      namecheap: {
        apiUser: "user",
        apiKey: "key",
        username: "user",
        clientIp: "127.0.0.1",
      },
    });

    expect(typeof provider.listRecords).toBe("function");
    expect(typeof provider.createRecord).toBe("function");
  });
});
