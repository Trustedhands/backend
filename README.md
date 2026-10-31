# TrustedHands API

NestJS backend for TrustedHands, a marketplace for verified home help in Kigali. It serves the client PWA and the admin console.

TrustedHands is **ops-mediated**. Clients describe a job, the TrustedHands team prices it and assigns a vetted worker, and the client pays by MTN Mobile Money. Workers have no app; admins manage them.

## Stack

- **NestJS 12** (ESM), domain-driven layout
- **Prisma 7** with the `pg` driver adapter, on **Supabase Postgres**
- **Supabase Auth**: the frontends sign users in; the API verifies the access tokens against the project's JWKS
- **MTN MoMo Collections API** for payments
- Vitest (unit + e2e), oxlint, Prettier

## Getting started

```bash
pnpm install          # also generates the Prisma client
cp .env.example .env  # then fill in the values
pnpm db:deploy        # apply migrations
pnpm start:dev        # http://localhost:3000
```

- API docs: http://localhost:3000/docs. The OpenAPI JSON at `/docs/openapi.json` is what the frontends generate their typed client from.
- Health check: `GET /health`
- All other routes are under `/v1` and need `Authorization: Bearer <supabase access token>`.

### Database connections

Supabase exposes two poolers, and both are used:

| Variable       | Port | Used by                                         |
| -------------- | ---- | ----------------------------------------------- |
| `DATABASE_URL` | 6543 | The running app (transaction pooler)            |
| `DIRECT_URL`   | 5432 | Prisma CLI: migrations, studio (session pooler) |

All app tables live in the **`app` schema**, not `public`. Supabase's Data API (PostgREST, reachable with the public anon key) only exposes `public`. That keeps every read and write going through this API. Don't move tables into `public` without enabling RLS.

### Making someone an admin

Admins are ordinary Supabase Auth users whose profile has `role = ADMIN`. After they've signed up:

```bash
pnpm admin:promote ops@example.com "Ops Name"
```

## Architecture

```
src/
  config/            env validation
  shared/
    auth/            Supabase JWT guard (global), @Public(), @Roles(), @CurrentUser()
    database/        PrismaService
    domain/          DomainError hierarchy (mapped to HTTP by DomainExceptionFilter)
    http/            filters, shared DTOs
  modules/<context>/
    domain/          aggregates, value objects, repository ports (no Nest, no Prisma)
    application/     use cases; ports for external services
    infrastructure/  Prisma repositories, read-side queries, provider adapters
    presentation/    controllers, request DTOs, response views
```

Bounded contexts:

- **identity**: client profile and home address. Email and phone verification state is read from `auth.users`.
- **workers**: admin-managed worker records, plus rating and job stats.
- **service-requests**: the `ServiceRequest` aggregate and its lifecycle (see below). Client and admin endpoints.
- **payments**: the `Payment` aggregate, the MoMo gateway and payment history.

Contexts with real invariants (service requests, payments) use aggregates, repositories and optimistic locking. The CRUD-shaped ones (identity, workers) use Prisma directly from the application service. Reads go through query services that shape rows into views, separate from the command path.

### Service request lifecycle

```
REQUESTED ──price──▶ PRICED ──pay──▶ PAID ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──▶ COMPLETED
                      │  ▲
       ask to adjust  ▼  │ re-price
               ADJUSTMENT_REQUESTED

Cancel: client before payment; ops until work starts (refund separately).
```

Every transition is recorded in `service_request_events`, which drives the progress timeline in the app.

### Payments

1. `POST /v1/service-requests/:id/payments { msisdn }` sends a MoMo prompt to the payer's phone. The status is `PENDING`.
2. The client polls `GET /v1/payments/:id`, which refreshes the status from MoMo. MoMo also calls `MOMO_CALLBACK_URL/<paymentId>`. Its body is ignored; it only triggers the same authoritative status check.
3. When MoMo reports `SUCCESSFUL`, the payment and the request's `PAID` transition are committed together, and the update is idempotent.

The design rules behind this flow:

- Payment attempts for a request are serialised with a row lock, so a double tap reuses the pending charge.
- The price can't change while a charge is pending.
- A network error on `requesttopay` leaves the payment `PENDING`, since MoMo may have accepted it. Only a definite 4xx rejection marks it `FAILED`.

The MoMo sandbox only accepts `EUR` and its own test numbers. Set `MOMO_TARGET_ENVIRONMENT` and `MOMO_CURRENCY=RWF` for production, which also enforces MTN Rwanda numbers (078/079).

## Testing

```bash
pnpm test       # unit tests (domain)
pnpm test:e2e   # full lifecycle against the database in .env; cleans up after itself
pnpm lint && pnpm typecheck
```

The e2e suite fakes only the token verifier and the MoMo gateway.
