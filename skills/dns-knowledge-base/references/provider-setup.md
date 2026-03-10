# Provider Setup Reference

## Cloudflare

### What the user needs

- Cloudflare account with zone added.
- API Token from Cloudflare Dashboard -> My Profile -> API Tokens.

### Recommended token permissions

- Zone -> DNS -> Edit
- Zone -> DNS -> Read
- Zone -> Zone -> Read

Scope token to specific zones when possible.

### Helmsman env vars

- `DNS_PROVIDER=cloudflare`
- `CLOUDFLARE_API_TOKEN=<token>`
- Optional: `CLOUDFLARE_ZONE_MAP={"example.com":"<zone-id>"}`
- Optional: `CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4`

### Common issues

- 403 errors: token scopes too narrow or wrong zone scope.
- Zone not found: wrong domain input or missing/incorrect zone map.

## Namecheap

### What the user needs

- Namecheap account with API access enabled.
- API key.
- Whitelisted public client IP.

### Helmsman env vars

- `DNS_PROVIDER=namecheap`
- `NAMECHEAP_API_USER=<username>`
- `NAMECHEAP_API_KEY=<api-key>`
- `NAMECHEAP_USERNAME=<username>`
- `NAMECHEAP_CLIENT_IP=<public-ip>`
- Optional: `NAMECHEAP_API_BASE_URL=https://api.namecheap.com/xml.response`

### Common issues

- API access denied due account eligibility restrictions.
- Client IP mismatch (not whitelisted).
- Sandbox endpoint used when trying production domain operations.

## Capability notes

- Record CRUD: Namecheap + Cloudflare
- Pricing: Namecheap only
- Availability: Namecheap API if configured, else RDAP heuristic
- Public DNS debug/inspect/propagation/email health: no provider creds required
