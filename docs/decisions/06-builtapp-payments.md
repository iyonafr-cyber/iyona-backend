# Decision 06 — Built-app payments architecture

## Problem

Jarvis-built apps can today set Stripe **publishable + secret** keys
via `Project Settings → Payments`. The keys are encrypted at rest
(`paymentConfig.stripeSecretKey` is AES-encrypted in
`projects.service.ts`), but:

- **There is no end-to-end design for what those keys do.** No
  injection into the deployed bundle, no secret-key handling on the
  built app's server (which doesn't exist), no webhook routing.
- The built-app preview iframe runs on `*.jarvis.site`. Any Stripe
  flow on that origin would attribute payments to **us**, not the
  builder.
- PCI scope: storing a customer's secret key (even encrypted) puts
  Jarvis adjacent to PCI scope. We need to either eliminate the key
  custody or accept the obligation explicitly.
- We've already shipped a product surface implying this works
  (PR-1.8 hid the panel behind a feature flag specifically to stop
  the bleeding for launch). We owe the design call before the flag
  flips.

Three architectures are credible. They differ on who holds the secret
key, who serves the runtime, and what the user has to configure.

## Options

### A. Stripe Connect (platform model) — recommended long term

Jarvis is the Stripe **platform**, the builder's account is a
**Connected Account** (Express or Custom).

- Builder one-click connects their Stripe account via the OAuth
  redirect Stripe ships with Connect.
- Jarvis stores only the connected `accountId`, never a secret key.
- Built apps call our Edge function with the `accountId`; we proxy
  the Stripe API call server-side using **our** secret key + the
  `Stripe-Account` header.
- Jarvis can take a platform fee (`application_fee_amount`) on every
  transaction — instant business model.
- Webhooks from Stripe are routed to Jarvis, fanned out to per-app
  webhook URLs.

Effort: 1.5–2 sprints (Connect onboarding flow, account-aware
serverless API, webhook fan-out, reconciliation tooling, accounting).

Pros:
- No secret-key custody; PCI scope stays at SAQ-A (we collect no
  card data).
- Clean revenue model.
- Matches what every other "build a SaaS in a day" platform does
  (Vercel marketplace, Bubble, Webflow Ecommerce).

Cons:
- Every connected account is subject to Stripe's onboarding KYC.
- 1.5–2 sprints of engineering and a real Stripe relationship.
- Requires explicit terms-of-service updates.

### B. Edge-function template (BYO Stripe, builder owns the secret)

- We never see the secret key. The user creates a Supabase Edge
  Function (or Vercel Function) named `stripe-checkout`, pastes their
  secret key into the function's env, and the AI generator scaffolds
  it.
- Jarvis injects only the **publishable** key into the Vite bundle.
- Stripe webhooks point at the user's Edge Function; we have no
  visibility.

Effort: 1 sprint (template + scaffolding + UI panel + E1 + E2
documentation).

Pros:
- No PCI exposure for Jarvis.
- Works today on Supabase + Vercel.
- Lets advanced users start charging fast.

Cons:
- Each builder has to do PCI on their own (still SAQ-A if they only
  use Checkout, but they have to know that).
- No platform fee; we don't make money off the transactions.
- Can't show "Subscription revenue" dashboards inside Jarvis because
  webhooks don't come to us.

### C. Hosted Checkout proxy (lightest)

- Builder picks a price/product on a Stripe-hosted checkout link.
- We don't store any keys at all — we just embed the Stripe Checkout
  Link in the built app.
- No secret-key custody, no webhooks, no platform.

Effort: 1–2 dev-days.

Pros: smallest surface; nothing to break.

Cons: no per-transaction logic in the built app; doesn't support
subscriptions with metadata, dynamic prices, invoice flows. It's a
"link to my Gumroad" experience.

### D. Defer (status quo)

Keep the Payment panel hidden behind the `builtAppStripe` feature
flag from PR-1.8. Document a "coming soon" banner.

Effort: zero.

Pros: no committee decisions. Cons: visible product gap.

## Recommendation

Two-phase ship:

1. **Now (option C)** — hosted Checkout link. We can ship this in a
   day, it gives users *something* to charge with, and it costs us
   nothing operationally. We rename the Payment panel to "Charge for
   access" and let users paste a Stripe Checkout link that the
   generator wires into a CTA button.
2. **Within Q3 (option A)** — Stripe Connect as the proper platform
   model. This is the right destination for the business: it gives
   us a revenue model (platform fee), removes the awkward "paste your
   secret key" UX, and matches enterprise procurement expectations.

Option B is the worst of both worlds (custody friction without the
revenue or UX of Connect) and we should skip it.

Option D is what we have today; ship option C in the next sprint to
close the gap.

## Implementation outline

### Now (option C — hosted Checkout link)

1. Schema: replace `paymentConfig.stripeSecretKey` with
   `paymentConfig.checkoutLinkUrl` (validated as
   `https://buy.stripe.com/...` or `https://checkout.stripe.com/...`).
2. Drop the secret-key encryption path entirely; back-fill nulls,
   migrate existing pasted keys (none in prod) by clearing them.
3. AI generator: when `paymentConfig.checkoutLinkUrl` is set, scaffold
   a `<a href={checkoutLinkUrl} target="_blank">Buy now</a>` button
   the user can place anywhere.
4. UI: Payment panel now collects only the Checkout link + button
   label. Removes the "secret key" field with a one-time migration
   notice.

### Q3 (option A — Stripe Connect)

1. Stripe Platform onboarding: create a platform account, enable
   Connect Express + Custom.
2. Backend
   - `POST /projects/:id/payments/connect` → returns the Connect
     onboarding URL.
   - `GET /payments/connect/callback` → finalises the connection,
     stores `accountId`, fires `project.payments.connected` webhook.
   - `POST /payments/api/charges`, `POST /payments/api/checkout`,
     `POST /payments/api/subscriptions` — proxy endpoints that take
     the project id, look up `accountId`, call Stripe with
     `Stripe-Account: <acct_…>`. Server-side rate limited.
   - `POST /payments/webhook` — single webhook receiver, fans out
     events to per-project webhook URLs.
3. AI generator: scaffolds a Stripe-aware client that talks to the
   proxy, never to Stripe directly.
4. Platform fee: configurable per plan in `plans.ts`.
5. Reconciliation + dashboard: a Payments tab inside the project
   showing connected status + recent events.

## Open questions

- What's the platform fee % we want to charge under option A?
  Recommended: 2.9% on top of Stripe's processing on Free/Hobby, 0%
  on Team+. Sales lever for upgrades.
- Tax handling — Stripe Tax under option A is opt-in per connected
  account; we surface the toggle but don't enforce it.
- Currency: do we let the connected account choose any of Stripe's
  135 currencies or restrict to a top-10 list? Recommended: any —
  Stripe handles the rest.
- Refund flow under option A: do we expose a "Refund" button inside
  Jarvis or send users to their Stripe dashboard? Recommended: punt
  to Stripe dashboard for v1; revisit when we have a Payments tab.
- Compliance: terms of service + connected-account terms need a
  legal review before option A ships.
