# Research API

Backend for the research draft API (`/v1/draft`, contract in
`src/lib/research/persistence-contract.ts`). Copied from prototype-v2 with
imports retargeted to `../../src/lib`.

## Layout

- `backend/` - provider-agnostic core: request handler, validation, database,
  admission (daily quota + circuit breaker), housekeeping, migration, and the
  private verifier, plus bun tests.
- `azure/` - Azure Functions bindings and HTTP adapter (bearer auth, CORS,
  streaming body limits) around the shared core.
- `edge/` - Cloudflare Worker gateway for the AWS Lambda Function URL
  (Turnstile verification, Durable Object admission rate limiting, SigV4
  signing) plus its bun tests.
- `build-backend.mjs` - bundles Lambda artifacts (api, migration,
  housekeeping, verification) with the official RDS CA bundle.
- `build-azure.mjs` - bundles Azure Functions ZIPs with the locked SDK.

## Commands

- `bun test api` - full API test suite (or `npm run test:security` for the
  core admission/validation/gateway set).
- `npm run build:backend` - Lambda ZIPs in `api/dist-backend`.
- `npm run build:azure` - Azure ZIPs in `api/dist-azure`.

Deployment/provisioning scripts and infrastructure definitions were not
copied from prototype-v2; pull them over separately if needed.
