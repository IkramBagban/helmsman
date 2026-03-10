# @helmsman/dns

DNS provider package for Helmsman.

## Features

- Inspect DNS records (`dns_inspect_records`) from provider or public resolvers
- Debug DNS resolution (`dns_debug_resolution`) and compare provider vs public state
- Check propagation across public resolvers (`dns_check_propagation`)
- Check email DNS posture for SPF/DMARC/DKIM (`dns_check_email_health`)
- Check domain registration details via RDAP (`dns_domain_details`)
- Check domain availability (`dns_check_domain_availability`)
  - Uses Namecheap live API when configured
  - Falls back to RDAP heuristic without credentials
- Check domain pricing via Namecheap (`dns_check_domain_pricing`)
- Create/update/delete DNS records via Namecheap

## Namecheap env vars (required for write operations and live availability/pricing)

- `NAMECHEAP_API_USER`
- `NAMECHEAP_API_KEY`
- `NAMECHEAP_USERNAME`
- `NAMECHEAP_CLIENT_IP`

## Optional

- `NAMECHEAP_API_BASE_URL` (default: sandbox endpoint)

## Credentialless behavior

Without provider credentials, read-only public capabilities still work:

- `dns_inspect_records` (public resolver mode)
- `dns_debug_resolution` (public mode with `providerConfigured=false`)
- `dns_check_propagation`
- `dns_check_email_health`
- `dns_domain_details`
- `dns_check_domain_availability` (RDAP heuristic)

Write tools and live registrar pricing require provider credentials.

## Record Mutation Notes

For Namecheap, `setHosts` replaces the full DNS host set. The provider implementation fetches current records, applies the requested mutation by `recordId`, and submits the complete updated set.
