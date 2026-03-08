# DNS and Domain Platform Architecture

Status: Draft
Date: March 8, 2026

## Purpose

Describe how Helmsman should support DNS and domain workflows in a unified, provider-agnostic way.

This document answers:
- What a DNS/domain system should include
- What users will ask for
- What we should build vs. what we should not build
- Which providers we can integrate
- How onboarding should work
- What permissions and credentials we need
- How approvals, safety, and anti-hallucination controls should work

## Short Answer

Yes, Helmsman can support a DNS and domain system.

But Helmsman should not build its own public DNS network or become its own registrar.

Helmsman should build a control plane for DNS and domains on top of existing providers.

That means:
- use existing DNS providers for authoritative DNS
- use existing registrars for registration, renewal, availability, and transfer operations
- add a unified abstraction inside Helmsman so users can talk naturally and Helmsman maps that to the right provider APIs

## The Important Distinction

There are two related but different domains here.

### 1. DNS hosting / DNS providers

These systems host zone files and answer DNS queries for a domain.

Examples:
- Cloudflare DNS
- AWS Route53
- Azure DNS
- Google Cloud DNS
- DNS Made Easy
- NS1

Typical functions:
- create zone
- list records
- add/update/delete DNS records
- manage NS delegation
- configure DNSSEC
- routing policies / failover / geo DNS / weighted DNS
- health checks
- proxy / CDN / WAF features in some providers

### 2. Domain registrars

These systems sell and manage domain registrations.

Examples:
- Namecheap
- GoDaddy
- Cloudflare Registrar
- Porkbun
- Hover
- Gandi
- Dynadot

Typical functions:
- check domain availability
- register domain
- renew domain
- transfer domain
- manage WHOIS/contact data
- nameserver changes
- registrar lock / transfer lock
- privacy settings
- expiration monitoring

A user may think these are one thing. In product terms, Helmsman should make them feel unified, but internally they are separate provider classes.

## What Users Will Want Helmsman To Do

### DNS record management
- list DNS zones
- list DNS records
- create A, AAAA, CNAME, TXT, MX, NS, SRV, CAA records
- update TTL
- delete records
- bulk import/export records
- clone records between environments
- create validation records for SSL or email services

### DNS debugging
- explain why a domain is not resolving
- trace delegation issues
- compare authoritative DNS vs public resolver results
- check propagation
- detect conflicting records
- detect wrong nameservers
- detect missing apex/root records
- detect broken MX/SPF/DMARC/DKIM records
- detect missing CAA for certificate issuance
- detect stale or duplicate records
- explain CDN / Cloudflare proxy / Route53 alias behavior

### Advanced DNS operations
- weighted records
- failover records
- latency routing
- geo routing
- health checks
- DNSSEC enable/disable/status
- split-horizon or private zones where provider supports it
- subdomain delegation

### Domain and registrar operations
- search domain availability
- suggest alternative domains
- compare price across providers
- register new domain
- renew domain
- transfer domain
- update nameservers
- check expiration date
- enable privacy protection where supported
- enable or verify registrar lock

### Application-adjacent workflows
- connect domain to Vercel / CloudFront / ALB / Nginx / Kubernetes ingress
- configure SSL validation records
- configure email records for Google Workspace / Microsoft 365 / SES / Resend / SendGrid
- setup redirect domains
- add WWW/non-WWW canonical DNS
- diagnose why SSL is pending because DNS is wrong

## What Else DNS Provides

If you want the full picture, DNS is not just “point domain to IP”.

### Core capabilities
- authoritative records
- delegation from parent domain to child nameservers
- service discovery via SRV/TXT
- mail routing via MX
- certificate policy via CAA
- ownership validation via TXT/CNAME
- private/internal DNS for cloud environments

### Operational capabilities
- traffic steering
- failover
- geographic control
- load balancing in some providers
- health checks
- anycast delivery in premium providers

### Security-related capabilities
- DNSSEC
- registrar lock
- domain transfer protection
- phishing / typo-squat monitoring if integrated externally
- certificate issuance constraints via CAA

### Platform-adjacent features some providers bundle
- CDN
- WAF
- DDoS protection
- reverse proxy
- bot mitigation
- edge redirects / rules
- email routing
- analytics

Cloudflare especially blurs the line between DNS provider and edge security/application platform.

## Product Recommendation

Helmsman should implement a unified `DNS & Domains` capability with provider adapters.

Helmsman should not implement:
- its own public recursive resolver
- its own authoritative DNS network
- its own ICANN registrar business
- its own registry relationships
- its own wholesale domain marketplace on day one

That would be an entirely different company.

Instead, Helmsman should become the orchestration and intelligence layer across:
- DNS providers
- registrars
- cloud platforms
- app platforms
- email providers

## Proposed Internal Product Model

### One user-facing capability

Users talk to Helmsman naturally:
- “point app.acme.com to my load balancer”
- “add Google Workspace MX records”
- “why is my domain not resolving?”
- “is acmeflow.ai available?”
- “find cheap domain options for my startup”
- “move DNS for my domain to Cloudflare”

### Multiple internal provider classes

#### DNS provider adapters
- Cloudflare DNS
- Route53
- Azure DNS
- Google Cloud DNS
- Namecheap DNS if API coverage is sufficient
- GoDaddy DNS if API coverage is sufficient

#### Registrar adapters
- Namecheap
- GoDaddy
- Cloudflare Registrar
- other providers later

#### Diagnostic sources
- authoritative DNS checks
- public resolver lookups
- WHOIS / RDAP
- SSL / certificate checks
- blacklists / DNS health services later

## Major Internal Component

Following the unified control plane model, DNS should be implemented as a domain-specific subsystem inside the control plane.

Suggested major subsystem:

`Domain Control Service`

Responsibilities:
- normalize domain and record intents
- resolve which provider owns DNS vs registrar ownership
- translate typed actions into provider calls
- enforce approvals for write/destructive changes
- track operation state
- compose trustworthy responses

## Suggested Abstractions

### Domain asset model

```ts
interface ManagedDomain {
  id: string;
  teamId: string;
  fqdn: string;
  apexDomain: string;
  registrarProvider?: string;
  dnsProvider?: string;
  registrarAccountRef?: string;
  dnsAccountRef?: string;
  zoneId?: string;
  nameservers?: string[];
  dnssecStatus?: "enabled" | "disabled" | "unknown";
  expiresAt?: string;
  autoRenew?: boolean;
}
```

### Typed DNS actions

```ts
interface DNSAction {
  type:
    | "zone.list"
    | "zone.create"
    | "record.list"
    | "record.create"
    | "record.update"
    | "record.delete"
    | "record.bulkImport"
    | "delegation.check"
    | "dns.debug"
    | "dnssec.enable"
    | "dnssec.disable";
  provider: string;
  domain: string;
  zoneId?: string;
  payload?: Record<string, unknown>;
}
```

### Typed registrar actions

```ts
interface DomainRegistrarAction {
  type:
    | "domain.availability.check"
    | "domain.price.check"
    | "domain.register"
    | "domain.renew"
    | "domain.transfer"
    | "domain.nameservers.update"
    | "domain.lock.enable"
    | "domain.lock.disable"
    | "domain.expiration.check";
  provider: string;
  domain: string;
  payload?: Record<string, unknown>;
}
```

## Providers We Can Integrate

### Strong initial targets

#### 1. AWS Route53
Why:
- already in roadmap
- already aligned with Helmsman’s AWS-first direction
- strong API coverage for DNS hosting
- good for hosted zones and record management

Good for:
- hosted zones
- record CRUD
- alias records to AWS resources
- health checks
- routing policies

Weak for:
- domain price comparison across market
- multi-registrar workflows

#### 2. Cloudflare
Why:
- huge real-world usage
- DNS + proxy + CDN + WAF + SSL edge features
- strong user demand

Good for:
- DNS CRUD
- proxied DNS
- zone settings
- SSL-related workflows
- CDN/security adjacent automation

Weak for:
- broad domain marketplace / price comparison across registrars

#### 3. Namecheap
Why:
- widely used by startups and indie users
- registrar + DNS use cases
- high demand for domain availability and cheap domain pricing

Good for:
- domain search
- domain registration workflows
- nameserver changes
- basic DNS in some cases

#### 4. GoDaddy
Why:
- large installed base
- many non-technical users already use it

Good for:
- registrar operations
- DNS record management for customer-owned domains

### Good follow-up providers
- Porkbun
- Cloudflare Registrar
- Gandi
- Dynadot
- Azure DNS
- Google Cloud DNS
- Vercel domain integrations
- Netlify domain integrations

## Recommended Implementation Strategy

### Phase 1: Route53 + Cloudflare DNS only

Goal:
Support DNS zone and record operations plus DNS debugging.

Capabilities:
- list zones
- list records
- create/update/delete records
- diagnose DNS issues
- support app connection workflows (CloudFront, ALB, Vercel-like future)

Why first:
- simpler than registrar workflows
- highest operational value
- overlaps with current DevOps value prop

### Phase 2: Add registrar adapters

Start with:
- Namecheap
- GoDaddy

Capabilities:
- availability search
- price lookup
- nameserver changes
- expiration check
- lock/privacy status

### Phase 3: Registration and transfer flows

Capabilities:
- register domain
- renew domain
- transfer in/out guidance
- compare pricing across providers

These require more billing/compliance care and stronger approvals.

### Phase 4: Advanced DNS intelligence

Capabilities:
- health checks and failover automation
- recommended DNS architecture generation
- email DNS validator
- migration assistants
- DNS drift detection
- security posture analysis

## What Users Need To Provide

It depends on the provider type.

### For DNS provider onboarding

#### Route53
Need from user/team:
- AWS credentials or assumed role
- allowed account(s)
- region context if needed for linked infra, though Route53 itself is global
- optionally known hosted zone IDs

#### Cloudflare
Need from user/team:
- Cloudflare API token with scoped permissions
- account ID
- optionally zone ID(s)

Recommended minimum scopes:
- Zone:Read
- DNS:Read
- DNS:Edit for write actions
- Zone Settings:Read if diagnostics need it

### For registrar onboarding

#### Namecheap
Need from user/team:
- API user / username
- API key
- allowlisted client IP where required
- optionally preferred TLD settings or account defaults

#### GoDaddy
Need from user/team:
- API key
- API secret
- customer account context if needed

### Common user/team inputs
- which provider accounts to connect
- which domains belong to which environments
- which environments are production
- whether Helmsman can do read-only, write, or destructive actions
- approval policy per environment/domain

## Onboarding Design

Onboarding should be provider-based, not one giant generic form.

### Step 1: Choose capability
User chooses one or more:
- Connect DNS provider
- Connect registrar
- Connect both

### Step 2: Choose provider
Examples:
- Route53
- Cloudflare
- Namecheap
- GoDaddy

### Step 3: Connect credentials securely
Options:
- OAuth where available
- API token/key
- assumed role for AWS
- secret reference from Helmsman vault

### Step 4: Discover assets
Helmsman should try to auto-discover:
- zones
- domains
- nameservers
- expiration dates where available
- connected DNS/registrar mismatch cases

### Step 5: Classify and confirm
Ask the user to confirm:
- production domains
- staging/dev domains
- critical domains
- whether auto-apply is allowed for low-risk changes
- approval requirements for DNS writes

### Step 6: Save policy and account bindings
Store:
- provider account refs
- domain-to-provider mapping
- environment mapping
- approval requirements

## Approval and Risk Model

DNS looks harmless, but some DNS changes are highly sensitive.

### Read-only
No approval needed:
- list zones
- list records
- check nameservers
- domain availability check
- price lookup
- expiration lookup
- propagation/debug checks

### Low-risk write
One-line notice or lightweight approval:
- add TXT validation record for SSL
- add temporary verification record
- create non-production subdomain

### Significant
Explicit approval required:
- change production A/CNAME/MX records
- change nameservers
- enable Cloudflare proxy on production records
- change TTLs for critical records if impact is meaningful
- update SPF/DMARC/DKIM for live mail domains

### Destructive
Hard confirmation required:
- delete production zone
- delete critical MX/SPF/DMARC records
- remove live apex records
- transfer domain away
- disable DNSSEC without explicit reason and confirmation

## Anti-Hallucination Rules

The DNS/domain system must not trust the model blindly.

### Required invariants
- the model does not decide provider ownership on its own without verification
- the model does not claim a record exists without reading provider state
- the model does not claim a domain is available without provider-backed lookup
- the model does not claim a price without provider-backed or clearly labeled cached price data
- the model does not claim propagation completed without actual checks
- the model does not modify production DNS without policy and approval gates

### Verification sources
- provider API state
- authoritative DNS lookup
- public resolver lookup
- WHOIS / RDAP
- nameserver comparison

## Domain Availability and Pricing

This is a separate capability from DNS hosting.

### Can Helmsman do this?
Yes.

### How?
By integrating registrar or domain search APIs.

Possible approaches:

#### Option A: Registrar-native APIs
Examples:
- Namecheap availability/pricing API
- GoDaddy domains API
- Porkbun API

Pros:
- direct pricing from source
- registration path available later

Cons:
- each provider differs
- price comparison becomes adapter-heavy

#### Option B: Aggregator / reseller API
Examples could include domain reseller marketplaces or broker APIs.

Pros:
- one API for many TLDs/providers
- easier cross-provider comparisons

Cons:
- dependency on third-party pricing aggregator
- margin/commercial questions
- less direct provider control

### Product recommendation
Start with provider-native APIs for 1-2 registrars first.
That gives reliable availability and pricing with less product ambiguity.

## “Cheap domain” Suggestions

This is feasible, but the system should be careful.

Helmsman can suggest:
- exact-match available domains
- alternate TLDs
- similar cheaper TLDs
- premium vs non-premium domains
- shortlists based on budget

Example:
- requested: `acmeflow.com`
- alternatives:
  - `acmeflow.dev`
  - `acmeflow.app`
  - `useacmeflow.com`
  - `acme-flow.com`

Important rules:
- clearly separate availability from recommendation
- clearly separate standard price from premium price
- clearly label prices as live or cached

## DNS Debugging Capabilities Helmsman Should Support

### Basic checks
- does the domain resolve?
- what are the authoritative nameservers?
- do public resolvers agree?
- does the record type exist?
- does the answer match the expected target?

### Intermediate checks
- propagation lag
- wrong zone/provider
- stale records
- CNAME flattening issues
- ALIAS/ANAME behavior differences
- Cloudflare proxy masking origin behavior
- Route53 alias target issues

### Advanced checks
- email deliverability misconfigurations
- DKIM/SPF/DMARC conflicts
- CAA blocking certificate issuance
- DNSSEC misconfiguration
- nameserver delegation mismatch at registrar vs zone provider
- split-horizon/private DNS confusion

## Things We Should Integrate Over Time

### DNS providers
- Route53
- Cloudflare
- Azure DNS
- Google Cloud DNS

### Registrars
- Namecheap
- GoDaddy
- Porkbun
- Cloudflare Registrar
- others based on demand

### Adjacent services
- ACM / certificate providers
- Let’s Encrypt / ACME workflow helpers
- Google Workspace
- Microsoft 365
- SES / SendGrid / Resend / Mailgun
- Vercel / Netlify / CloudFront / ALB / Nginx targets

### Diagnostic utilities
- authoritative DNS query services
- WHOIS / RDAP services
- SSL certificate inspection
- blacklist / reputation checks later

## What We Should Build In-House vs Use Existing

### Build in Helmsman
- unified provider abstraction
- natural-language task mapping
- approval and policy enforcement
- operation state tracking
- DNS diagnostic reasoning
- cross-provider orchestration
- onboarding flows
- environment-aware domain policies

### Use existing providers for
- authoritative DNS serving
- registrar inventory and registration
- domain pricing
- nameserver registry operations
- domain transfers
- actual public DNS resolution infrastructure

## Suggested Package/Module Direction

```text
packages/
  domains/ or tools-dns/
    src/
      providers/
        route53/
        cloudflare/
        namecheap/
        godaddy/
      actions/
      diagnostics/
      pricing/
      onboarding/
      policy/
      contracts/
```

Or, if staying within current architecture:
- provider adapters in a new package
- typed actions in shared contracts
- execution and approvals remain in the unified control plane

## Recommended Build Order

### Stage 1
- Route53 DNS CRUD
- Cloudflare DNS CRUD
- DNS diagnostics
- record-level approval policy

### Stage 2
- Namecheap availability + pricing
- GoDaddy availability + pricing
- domain suggestion engine

### Stage 3
- nameserver updates
- registrar lock/privacy/expiration checks
- onboarding UX for multi-provider domains

### Stage 4
- registration and renewal workflows
- transfer workflows
- mail DNS assistant
- DNS migration assistant

## What The User Experience Should Feel Like

The user should not have to know whether something is Route53, Cloudflare, Namecheap, or GoDaddy before they ask.

They should be able to say:
- “Add a CNAME for app.acme.com to this CloudFront distribution.”
- “Why is mail for acme.com failing?”
- “Is acmeflow.ai available? Show me cheaper alternatives too.”
- “Move my DNS to Cloudflare, but don’t break email.”

Helmsman should then:
1. identify provider ownership
2. verify state
3. propose safe plan
4. require approval when needed
5. execute through provider adapters
6. report truthful results and remaining risks

## Final Recommendation

Yes, implement this.

But implement it as a unified DNS and domain orchestration layer on top of existing providers.
Do not build your own DNS network or registrar.

The right product is:
- provider-agnostic
- approval-safe
- anti-hallucination by architecture
- transport-agnostic
- useful for both operators and non-expert users

That will give Helmsman a very strong expansion path beyond raw DevOps and into a high-value infrastructure control surface for internet-facing systems.
