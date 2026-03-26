---
name: cloudflare-knowledge
description: "Comprehensive Cloudflare knowledge base for Helmsman. Covers DNS provider setup, API token configuration, environment variables, supported operations, and troubleshooting."
helmsman:
  id: dns
  priority: 80
  keywords:
    - dns
    - domain
    - subdomain
    - record
    - zone
    - ttl
    - nameserver
    - cloudflare
    - namecheap
    - txt
    - mx
    - cname
    - a record
    - aaaa
  requires:
    env:
      - CLOUDFLARE_API_TOKEN
---

# Cloudflare Knowledge Base

Use this skill when users ask about Cloudflare integration, how to set it up, what operations are supported, or how to troubleshoot DNS issues involving Cloudflare.

## 1. Integration Scope
Helmsman integrates with Cloudflare primarily for **DNS Management**. It allows users to perform CRUD operations on DNS records directly through chat.

### Supported Operations:
- Listing DNS records for a zone.
- Creating new records (A, CNAME, TXT, MX, etc.).
- Updating existing records.
- Deleting records.
- Inspecting records across public resolvers vs Cloudflare state.
- Checking DNS propagation.

## 2. Setup Guide

### Phase 1: Cloudflare Dashboard Prerequisites
1. **Zones**: Ensure the domain (e.g., `example.com`) is already added to Cloudflare and active.
2. **API Token**: Create a "Scoped API Token" (preferred over Global API Key).
   - Go to **My Profile** > **API Tokens** > **Create Token**.
   - Use the **Edit zone DNS** template.
   - **Permissions Required**:
     - `Zone - DNS - Edit` (for record creation/updates)
     - `Zone - Zone - Read` (for zone discovery)
   - **Resources**: `Include - All zones` or specific ones.

### Phase 2: Helmsman Configuration
Add the following to the `apps/api/.env` file:

```bash
# Set active provider
DNS_PROVIDER=cloudflare

# Cloudflare Authentication
CLOUDFLARE_API_TOKEN=your_scoped_api_token_here

# Optional: Map domain names to Zone IDs for faster lookup
CLOUDFLARE_ZONE_MAP={"example.com":"<zone-id-from-cloudflare>"}

# Optional: Base URL (defaults to v4)
CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4
```

## 3. Operational Best Practices

### Verification
Always verify the setup by running a read-only command first:
- *"List DNS records for [domain]"*

### Record Mutation
When creating or updating records, Helmsman uses the Cloudflare DNS API. For Cloudflare specifically:
- Record operations require the `Record ID` (Helmsman fetches this automatically during inspection).
- TTL values should be sensible (e.g., `300` for 5 minutes, or `1` for "Automatic").

## 4. Troubleshooting Details

| Issue | Potential Cause | Resolution |
|-------|----------------|------------|
| **403 Forbidden** | Insufficient Token Permissions | Ensure `Zone:DNS:Edit` and `Zone:Zone:Read` are both enabled. |
| **Zone Not Found** | Incorrect Zone Map or Domain | Check `CLOUDFLARE_ZONE_MAP` JSON syntax or verify domain spelling. |
| **Connection Timeout** | API Base URL / Network | Verify `CLOUDFLARE_API_BASE_URL` is correct or check server egress. |
| **Invalid Record** | API Schema mismatch | Ensure type (A, CNAME) matches the value format (IP, Hostname). |

## 5. Interaction Templates
Use these patterns when guiding users:
- **Onboarding**: Explain the API Token creation steps clearly.
- **Confirmation**: After a write operation, suggest an inspection: *"I've updated the record. Would you like me to verify its propagation across public resolvers?"*
