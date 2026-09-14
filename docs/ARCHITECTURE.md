# KEOM — Frontend Architecture Blueprint

## Context

KEOM is a B2B SaaS control/visibility layer sitting on top of WhatsApp Business conversations: a NestJS backend (owned by another developer, living in this same monorepo) analyzes conversations and surfaces "opportunities needing human intervention" to sellers, and business performance metrics to admins/owners. This document locks the monorepo architecture, folder structure, conventions, and a phased implementation plan so that (a) frontend development can start immediately against mocks, (b) the eventual swap to the real NestJS backend requires no structural rework, and (c) the mock DNI auth can be replaced by real auth later without touching route/authorization logic.

Confirmed decisions:
- **apps/api lives in this same monorepo** (not a separate repo) — enables direct type-sharing via a `packages/contracts` package instead of publishing/duplicating types.
- **Single-tenant for MVP** — no org switcher, no tenant ID in routes/session. Keep it that way; don't pre-build multi-tenancy.
- **Spanish-only, no i18n scaffolding** — hardcode Spanish strings; don't pull in next-intl now.
- **Deploy target: Vercel** — safe to use Vercel-native features (Edge Middleware, Image Optimization) without an abstraction penalty.

---

## A. Architecture Decisions

| Decision | Choice | Why |
|---|---|---|
| Monorepo tool | pnpm workspaces + Turborepo | Two real apps (web, api) + 4 shared packages from day one justifies task caching/pipelines. Turborepo config stays minimal (build/lint/typecheck/test). |
| Frontend framework | Next.js (App Router, latest stable), TS strict | Server Components reduce client JS for a dashboard-heavy product; Server Actions cover simple mutations without a client data-fetching library. |
| Backend/frontend contract sharing | `packages/contracts`: plain TS interfaces (source of truth) + Zod schemas for runtime validation | Because both apps live in one repo, we get free type-sharing with zero publishing infra. Zod schemas validate API responses at the boundary — catches backend drift immediately instead of silently trusting `any`. NestJS DTOs (class-validator) are hand-aligned to these interfaces by convention for MVP; once the API stabilizes, generate types from the OpenAPI spec instead (Phase 11) rather than maintaining hand sync forever. |
| Auth for MVP | Custom lightweight session (not NextAuth) | NextAuth is built around OAuth/credential providers and adds real conceptual overhead for a "DNI lookup → signed session cookie" flow that will likely be **replaced by backend-issued sessions** once real auth exists. A thin custom `AuthService` abstraction is easier to swap than unwinding a NextAuth integration. |
| Global state | None (no Redux/Zustand) for MVP | Every piece of client state identified so far (theme, filters, session) has a better home: `next-themes`, URL search params, and a thin server-hydrated context, respectively. Introducing a store now would be state management without a state problem. |
| Server-state fetching | Server Components + Server Actions by default; **TanStack Query only for the Alerts feature** | Alerts is the one screen that genuinely needs polling/refetch-on-window-focus and optimistic UI ("Vamos por ello" should feel instant). Everything else (Reports, Risk, Admin Alerts table) is fine as server-rendered-on-navigation/search-param-driven. Scoping TanStack Query to one feature avoids it becoming the default hammer for everything. |
| Design system | shadcn/ui primitives + KEOM tokens in `packages/ui`; **domain components (AlertCard, RiskCard) stay in `apps/web`**, not in the shared package | There is exactly one consumer app. Promoting business-shaped components into a "shared" package before a second consumer exists is a classic premature abstraction. |
| PWA | Serwist (maintained App-Router-compatible successor to next-pwa) | `next-pwa` has known App Router friction; Serwist is the current pragmatic choice. Deferred to Phase 9 — not needed for the first demonstrable build. |
| Mobile nav | **Bottom tab bar, not a drawer**, for ≤3 nav items per role | A Sheet/drawer costs an extra tap for something as small as 2 destinations. A bottom tab bar is the standard mobile pattern for shallow nav and is always one tap away. Keep the drawer pattern in reserve — if a role's nav grows past ~4 items, switch that role to a drawer; don't build both now. |
| Testing | Vitest + RTL (unit/component), Playwright (E2E + a11y via `@axe-core/playwright`) | Least-friction option with Next.js App Router today. |

---

## B. Final Monorepo Folder Structure

```
keom/
├── apps/
│   ├── web/                          # Next.js frontend — the focus of this blueprint
│   └── api/                          # NestJS backend — owned by the other developer
│       ├── src/                      # (empty placeholder until backend dev scaffolds it)
│       ├── README.md                 # states ownership + how it consumes packages/contracts
│       └── package.json
│
├── packages/
│   ├── ui/                           # Shared design-system PRIMITIVES only
│   │   ├── src/
│   │   │   ├── components/           # shadcn-generated + KEOM-themed primitives (Button, Card, Badge, Sheet, Avatar, Skeleton...)
│   │   │   ├── theme/                # CSS variable tokens, risk-level tokens, light/dark definitions
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── contracts/                    # Single source of truth for FE↔BE data shapes
│   │   ├── src/
│   │   │   ├── auth.ts               # SessionUser, Role, LoginRequest/Response
│   │   │   ├── alerts.ts             # SellerAlert, AdminAlertRow, AlertStatus, Zod schemas
│   │   │   ├── risk.ts               # CustomerRisk, RiskLevel
│   │   │   ├── reports.ts            # AdminReport, RevenuePoint, LossReason, SellerMetric
│   │   │   ├── notifications.ts      # PushSubscriptionPayload, NotificationPayload
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── config/                       # Shared tooling config, imported not copy-pasted
│   │   ├── eslint/
│   │   ├── typescript/               # tsconfig.base.json
│   │   └── tailwind/                 # tailwind preset (tokens from packages/ui/theme)
│   │
│   └── mocks/                        # Canonical fixture data + mock generators
│       ├── src/
│       │   ├── fixtures/             # users.ts, alerts.ts, risk.ts, reports.ts (static, realistic sample data)
│       │   └── generators/           # small faker-based generators for volume/demo data
│       └── package.json
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
├── docs/
│   └── ARCHITECTURE.md               # this document
└── README.md
```

**Why `packages/mocks` is a real package (not just files inside `apps/web`):** it has ≥2 genuine consumers from the start — the web app's runtime mock services, and Playwright E2E fixtures (and later, Storybook if introduced). That clears the bar for extraction; `AlertCard`/`RiskCard` do not, since they have exactly one consumer.

**What is deliberately NOT a package:** anything with a single consumer. `apps/web`'s feature components, hooks, and services stay inside `apps/web` until (if ever) a second frontend app needs them.

---

## C. `apps/web` Internal Architecture

```
apps/web/
├── src/
│   ├── app/                          # ROUTING ONLY — thin, no business logic
│   │   ├── layout.tsx                # RootLayout: <html>, ThemeProvider, fonts, Toaster
│   │   ├── globals.css
│   │   ├── page.tsx                  # "/" → redirects by session role
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── seller/
│   │   │   ├── layout.tsx            # SellerLayout: session+role guard, AppShell(sellerNav)
│   │   │   ├── alerts/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [alertId]/page.tsx
│   │   │   └── risk/
│   │   │       └── page.tsx
│   │   ├── admin/
│   │   │   ├── layout.tsx            # AdminLayout: session+role guard, AppShell(adminNav)
│   │   │   ├── reports/
│   │   │   │   └── page.tsx
│   │   │   └── alerts/
│   │   │       ├── page.tsx
│   │   │       └── [alertId]/page.tsx
│   │   └── api/                      # Next Route Handlers — NOT a proxy to apps/api.
│   │       ├── auth/login/route.ts   # mock DNI login → issues session cookie
│   │       ├── auth/logout/route.ts
│   │       └── push/subscribe/route.ts  # stub for web push subscription storage
│   │
│   ├── features/                     # Feature/domain modules — where business logic + domain UI live
│   │   ├── alerts/
│   │   │   ├── components/           # AlertCard, AlertList, AlertDetail, PriorityBadge
│   │   │   ├── hooks/                # useSellerAlerts (TanStack Query), useAcknowledgeAlert
│   │   │   └── schemas/              # any UI-only zod schemas (form inputs, filters)
│   │   ├── risk/
│   │   │   ├── components/           # RiskCard, RiskFilterBar
│   │   │   └── hooks/
│   │   ├── reports/
│   │   │   ├── components/           # KpiCard, RevenueChart, LossReasonsChart, RecoveryBySellerChart, DateRangeFilter
│   │   │   └── hooks/
│   │   ├── admin-alerts/
│   │   │   └── components/           # AlertsTable, AlertDetailPanel
│   │   └── auth/
│   │       ├── components/           # LoginForm
│   │       └── actions.ts            # loginAction, logoutAction (Server Actions)
│   │
│   ├── components/
│   │   ├── layout/                   # AppShell, Sidebar (desktop), BottomTabBar (mobile), TopNav, ProfileMenu, ThemeSwitcher
│   │   └── shared/                   # EmptyState, ErrorState, PageHeader, LoadingSkeletons — generic, cross-feature, app-only (not shared package: single consumer)
│   │
│   ├── lib/
│   │   ├── services/                 # DATA LAYER — see Section H
│   │   │   ├── alerts/ (interface.ts, mock.ts, http.ts, index.ts)
│   │   │   ├── risk/
│   │   │   ├── reports/
│   │   │   └── notifications/
│   │   ├── auth/                     # session.ts (sign/verify/read cookie), getSession(), requireRole()
│   │   ├── http-client.ts            # typed fetch wrapper for apps/api calls, Zod-validates responses
│   │   └── utils.ts                  # cn(), formatCurrency(), formatRelativeTime()
│   │
│   ├── providers/                    # ThemeProvider, SessionProvider (hydrated from server, read-only), QueryProvider
│   ├── hooks/                        # Generic, cross-feature only: useMediaQuery, useIsMobile
│   ├── config/                       # nav.ts (per-role nav items), site.ts, env.ts (Zod-validated process.env)
│   └── middleware.ts                 # verifies session cookie, enforces /seller/* vs /admin/* at the edge
│
├── public/
│   ├── manifest.webmanifest
│   └── icons/
├── e2e/                               # Playwright specs, consumes packages/mocks fixtures
└── next.config.ts
```

**Placement rules (the parts worth stating explicitly):**
- **pages/routes** (`app/`): only layout composition + guards + data fetch orchestration. No component markup beyond assembling feature components.
- **feature components**: anything that knows about `SellerAlert`, `CustomerRisk`, `AdminReport` shapes.
- **generic UI**: `packages/ui` if shadcn-primitive-level; `components/shared` if app-specific-but-domain-agnostic (e.g., `EmptyState` takes a generic `title`/`icon`/`action` prop, no knowledge of alerts).
- **server actions**: colocated in the feature that owns the mutation (`features/auth/actions.ts`, `features/alerts/actions.ts`).
- **API clients / services**: `lib/services/*`, one interface + `mock`/`http` implementation per domain, never called directly from Client Components.
- **mocks**: canonical fixtures in `packages/mocks`; the `mock` service implementations in `apps/web/lib/services/*/mock.ts` just read/shape that fixture data.
- **hooks**: feature-specific → `features/*/hooks`; truly generic → `src/hooks`.
- **schemas**: contract-level (API shape) → `packages/contracts`; UI-only (form validation) → `features/*/schemas`.
- **types**: contract-level → `packages/contracts`; app-only (e.g., nav item shape) → inline or `src/config`.
- **providers**: `src/providers`, composed once in `app/layout.tsx`.
- **auth**: low-level session logic in `lib/auth`; UI in `features/auth`; enforcement in `middleware.ts` + layout guards (defense in depth, not redundancy — middleware blocks navigation, layout guard blocks direct RSC render).
- **notifications**: `lib/services/notifications` (subscribe/unsubscribe) + SW click-routing logic in the Serwist service worker file (Phase 9).
- **charts**: Recharts wrapper components live in `features/reports/components`; no separate "charts package" — this is the one screen that needs them.

---

## D. Route Map

```
/login                          public

/                                → redirect: no session → /login · SELLER → /seller/alerts · ADMIN → /admin/reports

/seller                         → redirect → /seller/alerts
/seller/alerts                  SELLER only
/seller/alerts/[alertId]        SELLER only — deep-link target for push notifications
/seller/risk                    SELLER only

/admin                          → redirect → /admin/reports
/admin/reports                  ADMIN only
/admin/alerts                   ADMIN only
/admin/alerts/[alertId]         ADMIN only
```

No route currently needs a tenant/org segment (single-tenant decision).

---

## E. Role-Based Layouts

- **RootLayout** (`app/layout.tsx`): `<html>`/`<body>`, font, `ThemeProvider` (next-themes), global `Toaster`. No nav chrome — shared by `/login` and both role trees.
- **AuthLayout** (implicit in `app/login/page.tsx`): centered card, no sidebar/topnav. Deliberately not a shared `AppShell` variant — it's structurally simpler, forcing a shared layout here would be the wrong kind of reuse.
- **SellerLayout** (`app/seller/layout.tsx`, Server Component): calls `getSession()`; if absent → redirect `/login`; if role ≠ SELLER → redirect to that role's home. Renders `<AppShell navItems={sellerNav}>{children}</AppShell>`.
- **AdminLayout** (`app/admin/layout.tsx`): identical pattern with `adminNav`.
- **AppShell** (`components/layout/AppShell.tsx`): the single shared shell both layouts render — this is what makes Seller and Admin "look like the same product." Takes `navItems` as a prop.

**Navigation strategy:**
- **Desktop (≥768px):** fixed left `Sidebar` inside `AppShell`, icon + label, no collapse logic needed for 2 items — collapsing is complexity with no payoff at this nav depth.
- **Mobile (<768px):** `Sidebar` hidden; `AppShell` renders a `TopNav` (logo, ProfileMenu, ThemeSwitcher) and a fixed `BottomTabBar` with the same `navItems` (see Section A for rationale vs. a drawer). Revisit only if a role's nav count grows past ~4 items.
- `ProfileMenu` and `ThemeSwitcher` live in `TopNav` on both breakpoints so they're always reachable without opening a drawer.

---

## F. Design System Strategy

- **shadcn/ui usage:** generate primitives directly into `packages/ui/src/components` (not `apps/web`) via the shadcn CLI, so both current and any future app share them. Customize the theme, don't fork component internals.
- **Theme tokens:** CSS variables in `packages/ui/src/theme`, consumed via the Tailwind preset in `packages/config/tailwind`. Standard shadcn semantic tokens (`background`, `foreground`, `primary`, `muted`, `destructive`, etc.) plus **KEOM-specific risk tokens**:
  ```
  --risk-high-bg / --risk-high-fg / --risk-high-border
  --risk-medium-bg / --risk-medium-fg / --risk-medium-border
  --risk-low-bg / --risk-low-fg / --risk-low-border
  ```
  Each risk/priority level always renders as **label + icon + tint**, never tint alone (e.g. `AlertTriangle` for HIGH, `AlertCircle` for MEDIUM, `Info` for LOW, each paired with the text "Alto"/"Medio"/"Bajo").
- **Light/dark mode:** `next-themes`, class-based, system-default with manual override via `ThemeSwitcher`. Every token defined for both modes at introduction — no light-only components that get dark mode bolted on later.
- **Typography:** Geist (ships zero-config with Next.js) — no need to add a separate font pipeline.
- **Spacing:** Tailwind's default scale. No custom scale for MVP.
- **Responsiveness:** desktop-first composition, but every shared layout/component is checked at a 375–400px viewport before being considered done.
- **Accessibility:** semantic HTML first, shadcn primitives (Radix-based) for anything interactive, visible focus states never removed, color-independent status indicators (see risk tokens above), all icons paired with text or `aria-label`.
- **Gradients:** subtle gradient utility (e.g. a `bg-gradient-card` Tailwind class) applied sparingly to KPI/summary cards only — not a system-wide treatment.

---

## G. State Management Strategy

| Concern | Mechanism | Why |
|---|---|---|
| Theme | `next-themes` | Solved problem, don't reinvent. |
| Auth session (read) | Server Components read via `getSession()`; a thin `SessionProvider` context hydrated once from the server for client components that need `role`/`name` (e.g. ProfileMenu) | No client-side session fetching; the cookie is the source of truth, context is just a read-only projection of what the server already verified. |
| Report/Risk filters (date range, seller, risk level, search) | **URL search params** (`useSearchParams` / `nuqs` if the boilerplate gets annoying) | Filters are shareable/bookmarkable state and drive server-rendered data — exactly what search params are for. No context or store needed. |
| Alerts list (Seller) | **TanStack Query** (poll/refetch on focus, optimistic update on acknowledge) | The one screen with a real "needs to feel live" requirement. |
| Everything else server-fetched (Reports, Risk list, Admin Alerts table) | Server Components, re-fetched on navigation/search-param change | No client cache needed; these aren't expected to change second-to-second. |
| Cross-page global client state | **None identified — don't add Zustand/Redux** | Revisit only if a real cross-page client concern shows up (e.g., a persistent "takeover in progress" banner) — and even then, prefer lifting to URL/server state first. |

---

## H. Data Layer

**Pattern:** one **interface** per domain in `packages/contracts` or colocated with the service, two implementations (`mock`, `http`), selected server-side by an env var — never exposed to or decided by the client.

```ts
// apps/web/src/lib/services/alerts/interface.ts
interface AlertsService {
  listSellerAlerts(sellerId: string): Promise<SellerAlert[]>;
  acknowledgeAlert(alertId: string): Promise<void>;
  listAdminAlerts(filters: AdminAlertFilters): Promise<AdminAlertRow[]>;
}
```

- `mock.ts` reads from `packages/mocks` fixtures (with simulated latency/failure for realistic loading/error states).
- `http.ts` calls `apps/api` through `lib/http-client.ts`, a typed `fetch` wrapper that **parses every response through the matching Zod schema from `packages/contracts` before returning** — this is the seam that catches backend drift instead of trusting `any`.
- `index.ts` per domain picks the implementation based on a **server-only** env var (`DATA_SOURCE=mock|http`), defaulting to `mock`. Never `NEXT_PUBLIC_*` — this switch is an implementation detail, not something the client needs or should be able to influence.
- Services are called only from Server Components, Server Actions, or the `app/api/*` Route Handlers that exist for Next-owned concerns (mock login, push subscription) — **never directly from Client Components**. Client Components trigger Server Actions or hit `app/api/*`.
- **Error handling:** services throw a small `ServiceError` (with a `code` for UI branching: `NOT_FOUND`, `UNAUTHORIZED`, `UPSTREAM_ERROR`); Server Components catch and render the shared `ErrorState`; Server Actions return a discriminated `{ ok: true, data } | { ok: false, error }` result consumed by the calling Client Component.
- **Transition to real backend:** flip `DATA_SOURCE=http` per domain independently (alerts can go live before reports do) — no UI code changes required, since both implementations satisfy the same interface and return the same `packages/contracts` types.

**Proposed contract refinements over the original draft:**
- Split `SellerAlert` (seller-facing shape) from `AdminAlertRow` (admin table row — needs `sellerName`, `acknowledgedAt`, `completedAt` that the seller view doesn't) — these are different read models of the same underlying alert, and forcing one shared interface would mean either over-fetching for the seller or optional fields with unclear meaning.
- `AdminReport` splits cleanly into a `ReportSummary` (the 4 KPI numbers) + separate typed arrays per chart (`revenueTimeline`, `lossReasons`, `recoveryBySeller`, `recoveryByTreatment`) — keeps each chart's data shape independently versionable.
- Add a `Money` type alias (`number`, minor-unit-free since these are Soles displayed directly — flag with the backend dev whether amounts should be integers/cents to avoid float rounding in revenue sums).

---

## I. Authentication Architecture

**Abstraction boundary:**
```ts
// packages/contracts/src/auth.ts
type Role = "SELLER" | "ADMIN";
interface SessionUser { id: string; dni: string; name: string; role: Role; }

// apps/web/src/lib/services/auth/interface.ts
interface AuthService {
  login(dni: string): Promise<SessionUser | null>;
}
```
- `MockAuthService`: looks up `dni` in a small static table (from `packages/mocks`) — no persistence needed for MVP.
- Real replacement later: `HttpAuthService` calling `apps/api`'s real auth endpoint — same interface, zero changes to session/middleware code.

**Session mechanics (the part that must be right from day one):**
- On successful mock login, `app/api/auth/login/route.ts` issues a **signed** (via `jose`, HS256 for MVP) **httpOnly, Secure, SameSite=Strict** cookie containing `{ id, role }` (never the DNI) and an expiry.
- `middleware.ts` verifies the signature on every request to `/seller/*` and `/admin/*`, and redirects on missing/invalid/role-mismatched sessions — this is the **edge boundary**, purely for UX (avoid rendering the wrong shell before redirect).
- `lib/auth/session.ts#getSession()` re-verifies the same cookie server-side inside each role layout (`SellerLayout`/`AdminLayout`) before rendering — **defense in depth**, not redundant: middleware failing open due to a config change shouldn't be the only thing standing between a SELLER and `/admin/*`.
- **Critical rule carried into Phase 11:** none of this — cookie, middleware, layout guard — is real authorization once a real backend exists. It stays as a UX-layer gate (don't flash the wrong screen). Every mutating/reading call to `apps/api` must independently re-check role server-side. Document this loudly; it's the single most common place teams cut corners later.
- Client Components that need `role`/`name` (ProfileMenu, conditional nav) read it from `SessionProvider`, which is hydrated **once, from the server**, from the already-verified session — the client never independently decodes or trusts the cookie.

---

## J. PWA and Notification Architecture

- **Manifest:** `public/manifest.webmanifest` — name "KEOM", theme color matching the primary token, icons, `display: standalone`.
- **Service worker:** Serwist, registered only in production builds (skip in dev to avoid caching-during-development pain). Precaches the app shell; runtime-caches nothing aggressive for MVP (this is a live dashboard, not an offline-first app — don't over-invest in offline strategy now).
- **Permissions:** Notification permission requested from an explicit UI affordance (e.g. a toggle in ProfileMenu/settings), never an unsolicited browser prompt on load.
- **Push subscription:** `lib/services/notifications` (`subscribe`/`unsubscribe`), posts the browser's `PushSubscription` (endpoint + keys) to `app/api/push/subscribe/route.ts` (stub for MVP — later forwards to `apps/api`, which owns actually sending pushes via VAPID + `web-push`).
- **Mock notification strategy:** a dev-only "Simulate alert" trigger (visible only when `DATA_SOURCE=mock`) that creates a mock `SellerAlert` and posts a message to the active service worker, which fires a local `Notification` — validates the full click-routing path without needing a real push server.
- **Notification click routing:** the service worker's `notificationclick` handler reads `data.url` (e.g. `/seller/alerts/{alertId}`) and calls `clients.openWindow`/focuses an existing tab and navigates — this logic is push-payload-shape-dependent, so `NotificationPayload` belongs in `packages/contracts` from the start even though push is a Phase 10 feature.
- **Backend integration path:** once `apps/api` can send real Web Push, nothing on the frontend changes except `DATA_SOURCE`/the subscribe endpoint target — the payload shape and click-routing logic were already built against the shared contract.

---

## K. Security Checklist

**Frontend responsibility:**
- [ ] Session cookie: httpOnly, Secure, SameSite=Strict, signed (jose/HS256 for MVP), short expiry + rotation on login.
- [ ] `middleware.ts` + layout guards on every `/seller/*` and `/admin/*` route — both, not either.
- [ ] Zero secrets in `NEXT_PUBLIC_*` — those are the *only* env vars sent to the browser bundle; `DATA_SOURCE`, `API_BASE_URL` (if it points somewhere non-public), signing keys all stay server-only.
- [ ] Zod-validate every external input: login form, any query params driving data fetches, and every `apps/api` response before use.
- [ ] Escape/sanitize any AI-generated summary text rendered in `AlertCard`/`RiskCard` — treat it as untrusted user-adjacent content even though it's generated server-side (React's default escaping covers most of this; just never `dangerouslySetInnerHTML` it).
- [ ] CSP via `next.config.ts` headers — start restrictive (`default-src 'self'`), allow-list only what's actually needed (fonts, if any external).
- [ ] Standard secure headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) set once in `next.config.ts`.
- [ ] CSRF: SameSite=Strict cookie + only accepting mutating requests via Server Actions/same-origin Route Handlers covers MVP risk; revisit if any cross-origin mutation path appears.
- [ ] No DNI logged anywhere (server logs, error boundaries, analytics) — treat it as PII even in mock form; log user `id` only.
- [ ] Avatar/photo URLs and phone numbers: don't expose customer PII in client-side error messages or console logs; scrub in any error reporting integration added later.
- [ ] `.env.example` documents every required var with a comment on sensitivity; never commit a real `.env`.

**Explicitly backend responsibility (call this out to the NestJS developer, don't silently assume FE covers it):**
- Real authorization on every endpoint (never trust a role claim forwarded from the frontend).
- Rate limiting / brute-force protection on login.
- Input validation server-side too (frontend Zod validation is UX, not a security boundary).
- Audit logging of who acknowledged/completed which alert.
- Actual PII storage/retention policy for customer data (phone, name, conversation summaries).

---

## L. Testing Strategy

| Layer | Tool | What deserves coverage in the MVP (not more) |
|---|---|---|
| Unit | Vitest | Zod schema validation (contracts), `lib/services/*/mock.ts` behavior, `lib/auth/session.ts` sign/verify round-trip, pure utils (`formatCurrency`, `formatRelativeTime`). |
| Component | Vitest + React Testing Library | `AlertCard`/`RiskCard` render correctly across priority/risk levels and loading/error/empty states; `AppShell` renders correct nav items per role. |
| E2E | Playwright | Two flows only for MVP: (1) mock login → redirected to correct role home → blocked from the other role's routes; (2) Seller opens Alerts → clicks "Vamos por ello" → sees acknowledged state + WhatsApp link. |
| Accessibility | `@axe-core/playwright` inside the E2E specs | Run against `/seller/alerts`, `/admin/reports`, `/login` — the three highest-traffic screens. Don't build a separate a11y test suite yet. |

Don't chase coverage percentages or test every shadcn primitive — those are already tested upstream.

---

## M. Development Phases

**Phase 0 — Monorepo Foundation**
- Goals: repo builds, lints, typechecks; workspace boundaries exist.
- Tasks: pnpm workspace + Turborepo setup; scaffold `apps/web` (Next.js, TS strict, Tailwind); create empty `apps/api` placeholder; scaffold `packages/{ui,contracts,config,mocks}` with minimal exports; root ESLint/Prettier/TS config wired through `packages/config`.
- Deliverables: `pnpm dev` runs `apps/web` with a blank page; `pnpm lint && pnpm typecheck` pass.
- Acceptance: fresh clone → `pnpm install && pnpm dev` works with no manual steps.
- Dependencies: none.

**Phase 1 — Design System**
- Goals: shared visual foundation usable by every later feature.
- Tasks: install shadcn CLI, generate core primitives into `packages/ui` (Button, Card, Badge, Sheet, Avatar, Skeleton, Input, Select, Tabs); define theme tokens incl. risk tokens; wire `next-themes`; build `ThemeSwitcher`.
- Deliverables: a `/design` scratch page (removed later) showing all primitives in light/dark.
- Acceptance: toggling theme updates every token live, no flash of unstyled content.
- Dependencies: Phase 0.

**Phase 2 — Mock Authentication**
- Goals: DNI login issues a real (signed) session; role-based redirect works.
- Tasks: `packages/mocks` user table; `MockAuthService`; `app/api/auth/login|logout`; `lib/auth/session.ts`; `middleware.ts`; `LoginForm`.
- Deliverables: `/login` → correct redirect by role; direct nav to the wrong role's route redirects away.
- Acceptance: tampering with the cookie value (not just deleting it) invalidates the session (signature check).
- Dependencies: Phase 0.

**Phase 3 — App Shell / Layouts**
- Goals: SellerLayout/AdminLayout share one visual shell.
- Tasks: `AppShell`, `Sidebar` (desktop), `BottomTabBar` (mobile), `TopNav`, `ProfileMenu`; per-role `nav.ts` config; wire into `SellerLayout`/`AdminLayout`.
- Deliverables: navigating between the (still-empty) seller/admin pages shows consistent chrome, responsive down to 375px.
- Acceptance: resizing the viewport swaps Sidebar↔BottomTabBar with no layout jump; ProfileMenu shows real session name/role.
- Dependencies: Phases 1, 2.

**Phase 4 — Seller Alerts**
- Goals: the flagship screen, fully functional against mocks.
- Tasks: `SellerAlert` contract + Zod schema; `AlertsService` (mock); `AlertCard`, `AlertList`; `useSellerAlerts` (TanStack Query); acknowledge flow (optimistic update + WhatsApp deep-link `wa.me/{phone}`); loading/empty/error states.
- Deliverables: `/seller/alerts` fully working end-to-end against mock data.
- Acceptance: acknowledging an alert updates its state without a full refetch and opens the WhatsApp link in a new tab.
- Dependencies: Phase 3.

**Phase 5 — Seller Risk**
- Goals: secondary seller screen.
- Tasks: `CustomerRisk` contract; `RiskService` (mock); `RiskCard`; search + level filter via URL search params.
- Deliverables: `/seller/risk` with working filters.
- Acceptance: filter state survives page refresh (it's in the URL).
- Dependencies: Phase 3.

**Phase 6 — Admin Reports**
- Goals: answer "is KEOM recovering money?"
- Tasks: `ReportSummary`/chart contracts; `ReportsService` (mock); `KpiCard` ×4; Recharts wrappers (revenue timeline, loss reasons, recovery by seller, recovery by treatment); date-range + seller + treatment filters via URL search params.
- Deliverables: `/admin/reports` fully populated from mock data, filters re-fetch server-rendered data.
- Acceptance: charts render correctly in both themes; empty-state handled if a filter yields no data.
- Dependencies: Phase 3.

**Phase 7 — Admin Alerts**
- Goals: audit/visibility table.
- Tasks: `AdminAlertRow` contract; `AlertsService.listAdminAlerts` (mock); `AlertsTable`; `AlertDetailPanel` (drawer or dedicated page).
- Deliverables: `/admin/alerts` table + detail view.
- Acceptance: status column never relies on color alone (label + icon).
- Dependencies: Phase 3.

**Phase 8 — Responsive + Accessibility Pass**
- Goals: harden what's built, not add features.
- Tasks: manual pass at 375/768/1280px on every screen; `@axe-core/playwright` run against the three key screens; fix violations.
- Deliverables: zero critical axe violations on `/login`, `/seller/alerts`, `/admin/reports`.
- Acceptance: keyboard-only navigation reaches every interactive element.
- Dependencies: Phases 4–7.

**Phase 9 — PWA**
- Goals: installable app shell.
- Tasks: manifest, icons, Serwist service worker (precache only), install prompt handling.
- Deliverables: Lighthouse PWA checks pass; app installable on mobile Chrome.
- Acceptance: offline reload of a previously visited route shows the app shell (not a browser error page) — data can still show an error/empty state.
- Dependencies: Phase 8.

**Phase 10 — Notifications**
- Goals: end-to-end mock push, ready for real backend swap.
- Tasks: `NotificationPayload` contract; permission request UI; subscribe endpoint stub; SW `notificationclick` routing; dev-only "simulate alert" trigger.
- Deliverables: simulated notification → click → lands on `/seller/alerts/{alertId}`.
- Acceptance: works with the app closed/backgrounded (real SW notification, not just an in-page toast).
- Dependencies: Phase 9.

**Phase 11 — Backend Integration**
- Goals: swap mocks for real `apps/api` per domain, independently.
- Tasks: implement `http.ts` per service against real endpoints; flip `DATA_SOURCE` per domain; replace `MockAuthService` with real backend-issued sessions; align/regenerate `packages/contracts` against the backend's actual OpenAPI spec.
- Deliverables: one domain (recommend: Alerts first, it's most tested) fully live against the real backend.
- Acceptance: no `apps/web` UI code changes required to flip a domain live — only the service implementation and env var.
- Dependencies: backend availability; Phases 4–10.

**Phase 12 — Security / Testing / Hardening**
- Goals: production-readiness pass.
- Tasks: CSP + secure headers finalized; run the full security checklist (Section K); Vitest/RTL/Playwright suites complete for the coverage described in Section L; load-test/error-boundary review.
- Deliverables: checklist signed off; CI runs lint/typecheck/unit/E2E on every PR.
- Acceptance: no unchecked item in Section K without an explicit documented reason.
- Dependencies: Phase 11.

---

## N. Proposed First Sprint

Goal: something visually demonstrable, running end-to-end on mocks, in one sprint.

1. Monorepo scaffold (pnpm + Turborepo), `apps/web` running, `apps/api` placeholder present.
2. `packages/ui` with core shadcn primitives + KEOM theme tokens (incl. risk tokens), light/dark working.
3. Mock DNI login (Carlos/SELLER, Andrea/ADMIN) issuing a real signed session cookie; `middleware.ts` role gating.
4. `AppShell` with responsive nav: Sidebar (desktop) / BottomTabBar (mobile), TopNav with ProfileMenu + ThemeSwitcher.
5. `/seller/alerts` fully built against `packages/mocks` fixtures: `AlertCard` (priority, avatar, value, AI summary, required action), "Vamos por ello" → acknowledge + WhatsApp deep-link.
6. One passing Playwright E2E: login → alerts → acknowledge.

This is deliberately narrower than doing Admin too — Seller Alerts is the highest-value, most-referenced screen in the spec, and finishing one screen end-to-end (including the E2E test) proves the whole architecture (auth, layout, data layer, contracts) faster than half-finishing four screens.

---

## O. Important Architectural Warnings

**Don't build yet:**
- Multi-tenancy / org switching (confirmed out of scope for MVP).
- i18n scaffolding (confirmed Spanish-only).
- A generic "data table framework" for Admin Alerts — build the one table you need.
- Offline-first data sync — the PWA is for installability + notifications, not offline editing.
- A permissions engine beyond the two hardcoded roles (SELLER/ADMIN) — a `hasPermission()` abstraction for two roles is speculative generality.
- Contract publishing/versioning infra (npm registry, semver on `packages/contracts`) — direct workspace imports are enough while both apps live in one repo.

**Overengineering traps to watch for:**
- Promoting `AlertCard`/`RiskCard` into `packages/ui` before a second consumer app exists.
- Reaching for Zustand/Redux the first time two components need to share state — check URL params and prop drilling first.
- Building a BFF/proxy layer of Next Route Handlers in front of `apps/api` "just in case" — Server Components/Actions can call it directly.
- Collapsible/nested sidebar navigation for what is currently a 2-item menu per role.
- Auto-generating `packages/contracts` from OpenAPI before the API has a stable enough surface for that to save time rather than cost it (Phase 11, not Phase 0).

**Security mistakes to avoid:**
- Storing `role` in a plain (unsigned) cookie or `localStorage` and trusting it anywhere.
- Treating `middleware.ts` as the only authorization check (it isn't, and never will be once `apps/api` is real).
- Putting `API_BASE_URL`/signing secrets behind `NEXT_PUBLIC_*` for convenience.
- Logging DNI or full customer phone numbers in server logs or error tracking.
- Skipping response validation (Zod) on `apps/api` calls because "we control both sides" — you won't always, and drift happens silently otherwise.

**Decisions that are hard to reverse later — get these right now:**
- Session/cookie format and the auth abstraction boundary (`AuthService` interface) — retrofitting this after real auth exists means touching every place that reads session data.
- The `/seller/*` vs `/admin/*` route prefixes — these will be baked into push-notification deep links and possibly backend webhook payloads; renaming later breaks saved links.
- `packages/contracts` shape choices (e.g., `SellerAlert` vs `AdminAlertRow` split) — changing the split after the backend has implemented matching DTOs is a coordinated two-repo-equivalent change even though it's one repo.
- Choosing Vercel-native middleware/edge features now (fine, per the confirmed deploy target) — reversing this if you ever need to self-host later requires re-validating edge-runtime-only code paths.

---

## Next Steps

**Phase 0 — Monorepo Foundation** is the next unit of work: pnpm workspace + Turborepo setup, `apps/web` scaffold, `apps/api` placeholder, and the four `packages/*` skeletons. See the acceptance criteria under Phase 0 above.
