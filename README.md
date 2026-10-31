# TrustedHands API

NestJS backend for TrustedHands, a marketplace for verified home help in Kigali. It serves the client PWA and the admin console.

TrustedHands is **ops-mediated**. Clients describe a job, the TrustedHands team prices it and assigns a vetted worker, and the client pays by MTN Mobile Money. Workers have no app; admins manage them.

## Stack

- **NestJS 12** (ESM), domain-driven layout
- **Prisma 7** with the `pg` driver adapter, on **Supabase Postgres**
- **Own JWT auth**: email + password, short-lived access tokens, rotating refresh tokens in an httpOnly cookie (see [Authentication](#authentication))
- **Resend** for email and **Africa's Talking** for SMS (verification and password-reset codes)
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
- All other routes are under `/v1` and need `Authorization: Bearer <access token>` (from `/v1/auth/login` or `/v1/auth/register`).

### Database connections

Supabase exposes two poolers, and both are used:

| Variable       | Port | Used by                                         |
| -------------- | ---- | ----------------------------------------------- |
| `DATABASE_URL` | 6543 | The running app (transaction pooler)            |
| `DIRECT_URL`   | 5432 | Prisma CLI: migrations, studio (session pooler) |

All app tables live in the **`app` schema**, not `public`. Supabase's Data API (PostgREST, reachable with the public anon key) only exposes `public`. That keeps every read and write going through this API. Don't move tables into `public` without enabling RLS.

### Making someone an admin

Staff are accounts with `role = ADMIN` and a **staff role** that decides what they can do (`src/shared/auth/permissions.ts`):

| Staff role        | Can                                                              |
| ----------------- | ---------------------------------------------------------------- |
| Super admin       | Everything, including settings and the team                      |
| Verification lead | Create and verify workers                                        |
| Finance           | Payments, refunds and payouts; view tickets                      |
| Customer service  | Tickets: assign, internal notes, email replies                   |

Every staff member can view the dashboard, requests, workers, clients and reviews. Admin endpoints declare what they need with `@RequirePermission()`. Roles are read from the database on each request, so changes take effect immediately.

To bootstrap the first super admin, register an account, then run:

```bash
pnpm admin:promote ops@example.com
```

Invite everyone else from Settings & team. Invitations are emailed links to `ADMIN_APP_URL/accept-invite` that work once and expire after 7 days.

## Authentication

| Endpoint (under `/v1/auth`)            | What it does                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| `POST register`                        | Creates the account and its client profile, emails a code, signs in  |
| `POST login`                           | Email + password                                                     |
| `POST refresh`                         | Rotates the refresh cookie, returns a new access token               |
| `POST logout`                          | Revokes this device's session                                        |
| `POST email/send-code`, `email/verify` | Email verification by 6-digit code                                   |
| `POST phone/send-code`, `phone/verify` | Phone verification by SMS code                                       |
| `POST password/forgot`, `password/reset` | Reset by emailed code; signs out every other session              |
| `POST password/change`                 | Needs the current password; signs out other sessions                 |

How it works:

- **Access tokens** are HS256 JWTs signed with `JWT_SECRET`, valid for 15 minutes. They carry only the user id; the role is read from the database on each admin request, so revoking it takes effect immediately.
- **Refresh tokens** are random, valid for 30 days, and stored only as SHA-256 hashes. They're set as an `httpOnly`, `SameSite=Lax` cookie scoped to `/v1/auth`, and are `Secure` in production. Every refresh rotates the token. Presenting an already-rotated token is treated as theft and revokes that whole session chain.
- **CSRF:** `refresh` and `logout` reject requests from an `Origin` outside `CORS_ORIGINS`.
- **Passwords** are hashed with scrypt (N=2^15). Login takes the same time whether or not the account exists.
- **Codes** are 6 digits and stored as HMACs. They expire after 10 minutes, allow 5 attempts, and can be resent after 60 seconds. Asking for a new code invalidates the previous one.
- **Rate limits:** auth endpoints allow 10 requests per minute per IP (30 for `refresh`). They're off when `NODE_ENV=test`. Behind a proxy, configure Express `trust proxy` so the limits apply to client IPs.
- **Email** goes through Resend (`EMAIL_PROVIDER=resend`). Mail comes from `TrustedHands <no-reply@EMAIL_DOMAIN>` unless `EMAIL_FROM` is set.
- **SMS** goes through Africa's Talking (`SMS_PROVIDER=africastalking`), using the sandbox when `AFRICAS_TALKING_USERNAME=sandbox`.
- **`log` providers** print messages to the server log instead of sending them. They're handy locally, and the server refuses to start in production with either set to `log`.

## Architecture

```
src/
  config/            env validation
  shared/
    auth/            access tokens, global guard, @Public(), @Roles(), @CurrentUser()
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

- **auth**: accounts, sessions, verification codes, email (Resend) and SMS delivery.
- **identity**: client profile and home address.
- **workers**: full worker profiles (identity, address, next of kin, payout details, and a photo and ID scans), a completeness checklist, and **two-admin verification**. Whoever added a worker can't verify them, and every ID check must be ticked. Changing identity details or documents on a verified worker sends them back for verification. Only verified, active workers can be held or assigned.
- **service-requests**: the `ServiceRequest` aggregate and its lifecycle (see below). Client and admin endpoints.
- **payments**: the `Payment` aggregate, the MoMo gateway and payment history.
- **configuration**: platform settings (fees, release rule, matching priority, payment-method toggles) and **service types**, which ops can add, rename, hide and re-order. Requests reference a service by its key.
- **team**: staff roles, invitations, and removing access.
- **operations**: dashboard figures, global search and the clients list.
- **reviews**: clients rate the worker on a completed job, once per job. Ratings of 2 or below are emailed to `SUPPORT_INBOX`.
- **support**: "Report an issue" tickets (`OPEN → ACTIVE → CLOSED`, reopenable), each optionally linked to a booking. New tickets are emailed to `SUPPORT_INBOX`.

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

When ops prices a request they also **hold** a worker. The worker must be verified, active and offer that service. Clients don't see the worker until it's **confirmed** after payment ("Confirm worker" moves the request to `ASSIGNED`). The platform fee comes from Settings, and placements are charged the match fee instead. "Suggested workers" ranks candidates by the matching priority in Settings: availability (clashing bookings, with a 30-minute buffer), language, gender, rating, and distance from the worker's GPS point to the address.

Admin actions such as verifications, settings changes and team changes are written to `audit_events`.

### Payments

1. `POST /v1/service-requests/:id/payments { msisdn }` sends a MoMo prompt to the payer's phone. The status is `PENDING`.
2. The client polls `GET /v1/payments/:id`, which refreshes the status from MoMo. MoMo also calls `MOMO_CALLBACK_URL/<paymentId>`. Its body is ignored; it only triggers the same authoritative status check.
3. When MoMo reports `SUCCESSFUL`, the payment and the request's `PAID` transition are committed together, and the update is idempotent.

The design rules behind this flow:

- Payment attempts for a request are serialised with a row lock, so a double tap reuses the pending charge.
- The price can't change while a charge is pending.
- A network error on `requesttopay` leaves the payment `PENDING`, since MoMo may have accepted it. Only a definite 4xx rejection marks it `FAILED`.

The MoMo sandbox only accepts `EUR`. Any number succeeds there except MTN's test numbers: `46733123450` always fails and `46733123453` stays pending. For production, set `MOMO_TARGET_ENVIRONMENT`, `MOMO_BASE_URL` and `MOMO_COLLECTION_CURRENCY=RWF`. That also limits payers to MTN Rwanda numbers (078/079).

MTN's failure codes (e.g. `NOT_ENOUGH_FUNDS`) are logged as-is and shown to the payer as plain-language messages.

## Testing

```bash
pnpm test       # unit tests (domain)
pnpm test:e2e   # auth + full lifecycle against the database in .env; cleans up after itself
pnpm lint && pnpm typecheck
```

The e2e suites use real auth; only email, SMS and MoMo are faked (see `test/support.ts`).

### Ticket attachments

Clients can attach up to 3 files of up to 5 MB each.

- **Allowed types:** JPG, PNG or PDF. The type is detected from the file's bytes, never from its name or the type the browser claims.
- **Storage:** files are stored in Postgres (`ticket_attachments`). That's fine at MVP volumes. To move them to object storage, change only `SupportService.create` and `SupportService.attachment`.
- **Serving:** files are served with `nosniff` and `Content-Security-Policy: sandbox`, so an uploaded file can't run script on the API's origin.
