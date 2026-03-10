---
name: dns-knowledge-base
description: "DNS/domain operations knowledge for Helmsman with Cloudflare (primary) and Namecheap (conditional). Covers setup prerequisites, required API keys, env wiring, capability boundaries, and troubleshooting for onboarding users."
license: Apache-2.0
metadata:
  author: Helmsman
  version: "1.0.0"
---

# DNS Knowledge Base

Use this skill when users ask about DNS setup, Cloudflare/Namecheap API onboarding, env variables, or what Helmsman can do in DNS.

## Scope

- Explain DNS capabilities in Helmsman truthfully.
- Guide provider setup for Cloudflare and Namecheap.
- Provide required keys and exact env vars.
- Troubleshoot common auth and provider errors.
- Suggest safe verification steps in Telegram.

## Provider Priority

1. Cloudflare first (free API access, no domain-count requirement).
2. Namecheap only if user already has API access enabled.

## Required setup checklist

Read: [provider setup](references/provider-setup.md)

## Answering rules

1. Never claim domain availability/pricing is exact unless from provider API output.
2. If provider credentials are missing, state which specific env vars are needed.
3. For Namecheap, explicitly warn about account eligibility/API restrictions.
4. For Cloudflare, recommend scoped API token (Zone DNS Edit/Read, Zone Read).
5. Always include a small verification flow (inspect, create test record, inspect again).

## Quick response templates

### "How do I set up Cloudflare with Helmsman?"

- Tell user to create API token in Cloudflare dashboard.
- Ask for token + optional zone map.
- Share env vars:
  - `DNS_PROVIDER=cloudflare`
  - `CLOUDFLARE_API_TOKEN=...`
  - `CLOUDFLARE_ZONE_MAP={"example.com":"zone-id"}` (optional)

### "What keys do I need for Namecheap?"

- Required:
  - `NAMECHEAP_API_USER`
  - `NAMECHEAP_API_KEY`
  - `NAMECHEAP_USERNAME`
  - `NAMECHEAP_CLIENT_IP` (must be whitelisted)
- Plus `DNS_PROVIDER=namecheap`
- Mention API eligibility gating by Namecheap account status.

### "How do I verify it works?"

1. `List DNS records for example.com`
2. `Create DNS record ... host helmsman-test type A value 1.2.3.4 ttl 300`
3. `Inspect DNS records for example.com host helmsman-test`
4. `Delete DNS record ... recordId <id>`
