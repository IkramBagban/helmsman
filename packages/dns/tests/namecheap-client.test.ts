import { describe, expect, it } from "bun:test";
import { NamecheapClient } from "../src/providers/namecheap/client.js";

describe("NamecheapClient.parseHosts", () => {
  it("should parse host records from XML", () => {
    const client = new NamecheapClient({
      apiUser: "u",
      apiKey: "k",
      username: "n",
      clientIp: "127.0.0.1",
    });

    const xml = `
      <ApiResponse Status="OK">
        <CommandResponse>
          <DomainDNSGetHostsResult>
            <host Name="@" Type="A" Address="1.1.1.1" TTL="300" />
            <host Name="mail" Type="MX" Address="mail.example.com" TTL="600" MXPref="10" />
          </DomainDNSGetHostsResult>
        </CommandResponse>
      </ApiResponse>
    `;

    expect(client.parseHosts(xml)).toEqual([
      { host: "@", type: "A", value: "1.1.1.1", ttl: 300, mxPref: undefined },
      {
        host: "mail",
        type: "MX",
        value: "mail.example.com",
        ttl: 600,
        mxPref: 10,
      },
    ]);
  });
});
