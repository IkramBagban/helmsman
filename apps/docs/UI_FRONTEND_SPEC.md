# Helmsman Frontend UI Spec (MVP)

## 1) Product UI Intent
Helmsman should feel like a **high-trust AI command center** for DevOps: calm, precise, powerful, and futuristic.

Design tone:
- Strategic, reliable, operator-grade
- Modern and cinematic (not playful)
- Fast to scan during technical workflows

---

## 2) Frontend Stack (Final)
- **Framework:** React (Next.js app in monorepo)
- **Styling:** Tailwind CSS
- **UI Library:** **shadcn/ui** (best fit for clean composable primitives)
- **Icons:** Lucide React
- **Typography approach:** System-friendly, highly legible sans-serif stack

Why shadcn/ui:
- Pairs naturally with Tailwind
- Gives consistent accessible primitives without visual lock-in
- Lets Helmsman keep a custom brand identity while moving fast

---

## 3) Brand-Aligned Theme Direction
Inspired by the same “AI that acts” energy as OpenClaw, but tuned for Helmsman’s DevOps mission.

### Core Palette
- **Background / Base:** Deep Command Navy `#061226`
- **Surface / Panels:** Midnight Blue `#0B1D3A`
- **Primary Accent:** Electric Cyan `#22D3EE`
- **Secondary Accent:** Aurora Blue `#3B82F6`
- **Text Primary:** Slate Ice `#E6EDF7`
- **Text Secondary:** Muted Steel `#9FB3C8`
- **Success:** `#22C55E`
- **Warning:** `#F59E0B`
- **Danger:** `#EF4444`

### Visual Language
- Dark, high-contrast background with subtle gradient depth
- Cyan/blue accents for action and intelligence cues
- Minimal glow only on primary interactive elements
- Crisp borders and cards for “control panel” feeling

---

## 4) UI Principles
1. **Command-first clarity** — users should understand state and available actions in 2–3 seconds.
2. **Readable at speed** — strong hierarchy, compact spacing, minimal decorative noise.
3. **Trust through structure** — clear status badges, deterministic wording, stable layouts.
4. **Consistency over novelty** — same button/card/input patterns everywhere.
5. **Aesthetic with purpose** — visually premium, but never at the cost of usability.

---

## 5) Component System (MVP)
Use shadcn/ui primitives styled with Helmsman theme tokens.

### Required Base Components
- `Button` (primary, secondary, ghost, destructive)
- `Card` (default, elevated, bordered)
- `Badge` (risk/status: read-only, low-risk, significant, destructive)
- `Input` and `Textarea`
- `Tabs`, `Separator`, `Tooltip`
- `Dialog` (for confirmation / approvals)

### Icons (Lucide)
- Navigation: `Compass`, `LayoutDashboard`, `Settings`
- Agent/automation: `Bot`, `Zap`, `BrainCircuit`
- Infra and security: `Server`, `Cloud`, `ShieldCheck`, `Lock`
- Execution states: `Loader2`, `CheckCircle2`, `AlertTriangle`, `XCircle`

---

## 6) App Information Architecture (MVP)

### A) Landing / Product Page
1. **Header**
   - Logo + product name (Helmsman)
   - Primary CTA: “Launch Console”
2. **Hero**
   - Strong one-line value prop
   - Subtext: AI agent that plans and executes DevOps tasks
   - Dual CTA: “Try Helmsman” + “View Architecture”
3. **Mission Section**
   - Why Helmsman exists (reduce manual infra toil)
4. **Core Features Section**
   - Plan → Approve → Execute loop
   - Policy/risk aware operations
   - Tool integrations (AWS, GitHub, runtime)
5. **Trust/Safety Section**
   - Approval gates, audit logs, guardrails
6. **Footer**
   - Docs, architecture, roadmap links

### B) Dashboard Page
Purpose: High-level operational visibility before diving into execution.

Required sections:
- **Top Summary Row**
   - Active tasks
   - Pending approvals
   - Last 24h success rate
   - Alerts/anomalies count
- **Recent Executions Panel**
   - Task title, status, risk level, timestamp
   - Quick action: “Open in Chat”
- **Approval Queue Panel**
   - Requests waiting for user approval
   - Risk badge and TTL indicator
- **Integrations Health Panel**
   - AWS, GitHub, Runtime connector status
   - Last sync/check timestamp

### C) Chat Command Center Page
Purpose: Primary place where user talks to Helmsman and gives commands.

Required layout:
- **Left Rail (optional on mobile drawer):** conversation/thread list
- **Main Chat Area:** user + assistant messages, tool execution messages, status badges
- **Right Context Panel:** current plan steps, approvals, execution logs (collapsible on smaller screens)
- **Bottom Composer:** multiline input, submit button, quick prompts

Required chat behaviors:
- Natural-language command input and response stream
- Explicit plan preview for multi-step tasks
- Approval prompts rendered as clear action cards
- Tool execution progress states: queued, running, success, failed
- Failure messages must include what failed + suggested next action

### D) Settings Page (Minimal)
- Profile/session basics
- Connected integrations overview
- Theme mode toggle hooks (if implemented later)

---

## 7) Interaction & Motion Rules
- Keep motion subtle: 120–180ms transitions
- No heavy animation loops
- Hover/focus feedback required on all interactive controls
- Loading states must always show progress intent (spinners + text)

---

## 8) Accessibility & UX Baseline
- AA contrast compliance for text/components
- Visible keyboard focus states on all controls
- Semantic headings and landmarks
- Error and success states must include icon + text (not color only)

---

## 9) Content Voice in UI
- Direct, operational, concise
- Avoid hype-y or vague copy
- Prefer exact outcomes and statuses:
  - “Plan created: 3 steps, 2 require approval”
  - “Step 2 failed: CloudFront distribution validation error”

---

## 10) Definition of Done for UI MVP
- React + Tailwind + shadcn/ui integrated
- Lucide icon set applied consistently
- Theme tokens implemented from this spec
- Responsive layout for mobile/tablet/desktop
- Landing page complete (Header, Hero, Mission, Features, Trust, Footer)
- Dashboard page complete (summary cards, recent executions, approvals, integrations health)
- Chat Command Center page complete (message area, plan panel, composer, execution states)
- Visual consistency validated across all base UI components
