# @helmsman/dns

DNS provider package for Helmsman.

## Features

- Inspect DNS records (provider-backed when configured, public resolver fallback otherwise)
- Debug DNS resolution (authoritative vs public)
- Check domain registration details via RDAP (no provider credentials required)
- Check likely domain availability via RDAP (no provider credentials required)
- Create, update, and delete DNS records via Namecheap

## Namecheap env vars (required for write operations)

- `NAMECHEAP_API_USER`
- `NAMECHEAP_API_KEY`
- `NAMECHEAP_USERNAME`
- `NAMECHEAP_CLIENT_IP`

## Optional

- `NAMECHEAP_API_BASE_URL` (default: sandbox endpoint)

## Credentialless behavior

Without provider credentials, read-only public capabilities still work:

- `dns_inspect_records` (public resolver mode)
- `dns_debug_resolution` (public mode with providerConfigured=false)
- `dns_domain_details`
- `dns_check_domain_availability`

Write tools require provider credentials.
