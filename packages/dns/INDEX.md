# dns

DNS management tools exposed to the agent. Currently supports Cloudflare as the DNS provider.

## Responsibility
Provides CRUD tools for DNS records (list, create, update, delete). Routes to the correct provider based on config.

## Key Files
```
src/
  tools.ts              ← Agent-facing DNS tools (dns_list_records, dns_create_record, etc.)
  provider-resolver.ts  ← Resolves active DNS provider from env config
  providers/            ← Provider implementations
    cloudflare.ts       ← Cloudflare API client and DNS operations
  types.ts              ← Shared DNS types (DnsRecord, DnsProvider, etc.)
  utils.ts              ← DNS utility helpers
  public-domain.ts      ← Public domain resolution utilities
  debug.ts              ← Debug utilities for DNS troubleshooting
```

## Exports
- `dnsTools` — array of DNS tools to register with the agent

## Env Vars
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token
- `CLOUDFLARE_ZONE_ID` — Default Cloudflare zone ID

## Dependencies
`@helmsman/shared`, `@helmsman/tools`
