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
      {
        id: "0",
        host: "@",
        type: "A",
        value: "1.1.1.1",
        ttl: 300,
        mxPref: undefined,
      },
      {
        id: "1",
        host: "mail",
        type: "MX",
        value: "mail.example.com",
        ttl: 600,
        mxPref: 10,
      },
    ]);
  });
});

describe("NamecheapClient domain parsing", () => {
  const client = new NamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "n",
    clientIp: "127.0.0.1",
  });

  it("should parse availability details", () => {
    const xml = `
      <ApiResponse Status="OK">
        <CommandResponse>
          <DomainCheckResult
            Domain="example.ai"
            Available="true"
            IsPremiumName="true"
            PremiumRegistrationPrice="120.0"
            PremiumRenewalPrice="110.0"
            PremiumRestorePrice="150.0"
            IcannFee="0.18"
            EapFee="0.00"
            Description="Domain is available"
          />
        </CommandResponse>
      </ApiResponse>
    `;

    expect(client.parseDomainAvailability(xml, "example.ai")).toEqual({
      domain: "example.ai",
      available: true,
      source: "namecheap",
      isPremium: true,
      premiumRegistrationPrice: 120,
      premiumRenewalPrice: 110,
      premiumRestorePrice: 150,
      icannFee: 0.18,
      eapFee: 0,
      message: "Domain is available",
    });
  });

  it("should parse one-year domain pricing", () => {
    const xml = `
      <ApiResponse Status="OK">
        <CommandResponse>
          <UserGetPricingResult>
            <ProductType Name="DOMAIN">
              <ProductCategory Name="register">
                <Product Name="com">
                  <Price Duration="1" DurationType="YEAR">
                    <ProductPrice
                      Duration="1"
                      DurationType="YEAR"
                      Currency="USD"
                      RegisterPrice="10.98"
                      RenewPrice="14.98"
                      TransferPrice="10.98"
                      RestorePrice="120.00"
                    />
                  </Price>
                </Product>
              </ProductCategory>
            </ProductType>
          </UserGetPricingResult>
        </CommandResponse>
      </ApiResponse>
    `;

    expect(client.parseDomainPricing(xml, "com")).toEqual({
      tld: "com",
      source: "namecheap",
      currency: "USD",
      registration: 10.98,
      renewal: 14.98,
      transfer: 10.98,
      restore: 120,
    });
  });
});
