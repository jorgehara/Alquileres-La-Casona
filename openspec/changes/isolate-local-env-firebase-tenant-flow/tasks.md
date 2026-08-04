# Tasks: Isolate Local Env Firebase Tenant Flow

> First chained slice only. Keep Firebase Hosting + Vanilla JS + Cloud Functions TypeScript. Focus on local/emulator tenant-flow isolation; do not redesign tenant UX, change tenant business rules, migrate data, add CI, or deploy production.

## Phase 1: Infrastructure / Environment Contracts

- [x] 1.1 Update `.firebaserc` and `.firebaserc.example` so local development uses the emulator-safe demo project id and does not require a production Firebase project alias.
- [x] 1.2 Update `firebase.json` emulator settings for Hosting, Functions, Firestore, Auth, Storage, Emulator UI, and `singleProjectMode` so local tenant flow has one explicit local Firebase boundary.
- [x] 1.3 Update `functions/.env.example` with localhost Hosting and Functions emulator URLs, placeholder-only integration secrets, and no production Cloud Functions URLs.
- [x] 1.4 Update `.gitignore` to keep local env files, Firebase runtime artifacts, emulator exports, and logs out of version control while preserving example files.

## Phase 2: Local Firebase Tenant-Flow Implementation

- [x] 2.1 Update `public/runtime-config.js` with a local/emulator runtime contract that can distinguish localhost/emulator execution from production Hosting.
- [x] 2.2 Update `public/firebase-config.js` so Auth, Firestore, Storage, and Functions SDK clients connect to emulators only when the runtime contract is local/emulator.
- [x] 2.3 Add a fail-fast guard in `public/firebase-config.js` that blocks local tenant-flow execution when client config or project id points at production.
- [x] 2.4 Review tenant entry points in `public/app.js` and keep existing tenant behavior while routing Firebase SDK/callable usage through the isolated local Firebase client boundary.
- [x] 2.5 Review public payment/receipt entry points in `public/verify-receipt.js` and `firebase.json` rewrites so local `/api/*` calls stay on Hosting/Functions emulators without changing production routes.
- [x] 2.6 Review Functions environment reads in `functions/src/config.ts` and tenant/onboarding handlers in `functions/src/modules/tenants.ts` so emulator execution relies on local env values and does not fall back to production URLs.

## Phase 3: Documentation / Guardrails

- [x] 3.1 Update `README.md` local development section with root-first commands for installing dependencies, copying `functions/.env.example`, building Functions, and starting emulators.
- [x] 3.2 Add a tenant-flow isolation runbook in `docs/local-tenant-emulator-flow.md` covering local Auth user creation, tenant invitation/onboarding checks, expected emulator ports, and production-safety warnings.
- [x] 3.3 Update `scripts/validate-local-dev.mjs` to assert emulator ports, demo project id, local env examples, ignored local files, frontend emulator connectors, and absence of production Firebase URLs in local config paths.

## Phase 4: Verification

- [x] 4.1 Run `npm run validate:local-dev` and confirm validation fails if production URLs/project ids are reintroduced in local config files.
- [x] 4.2 Run `npm run build:functions` to confirm TypeScript changes under `functions/src/config.ts` and `functions/src/modules/tenants.ts` compile on Node 20.
- [x] 4.3 Start local emulators with `npm run emulators` and verify Hosting, Functions, Firestore, Auth, Storage, and Emulator UI bind to the ports declared in `firebase.json`.
- [ ] 4.4 Exercise the local tenant onboarding/login path from `http://127.0.0.1:5000` and verify Auth, Firestore, Storage, and callable/function traffic lands in emulators, not production.
- [ ] 4.5 Exercise the local public receipt/payment route and verify `/api/*` requests resolve through Hosting rewrites to the Functions emulator without changing production route names.
- [ ] 4.6 Inspect changed files and confirm no tenant business rules, UX redesign, Firestore schema migration, CI workflow, production deploy script, or stack replacement was added in this slice.
