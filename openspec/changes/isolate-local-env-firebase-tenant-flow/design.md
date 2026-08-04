# Design: Isolate Local Env Firebase Tenant Flow

## Technical Approach

Keep the current stack unchanged: Firebase Hosting, vanilla ES modules in `public/`, Firebase Web SDK v10 CDN imports, Cloud Functions TypeScript, Firestore/Auth/Storage, and existing Hosting `/api/*` rewrites. The implementation slice should introduce an explicit browser runtime environment contract that makes local/emulator mode opt-in by URL/host/config and fail-fast when the browser could mix local pages with production Firebase resources.

No product behavior is redesigned. Tenant onboarding, callable Functions, Firestore access, Storage uploads, and token-portal HTTP endpoints continue using the same application APIs; only runtime selection and validation boundaries change.

Specs directory is not present yet for this change, so this design maps to the proposal success criteria and affected areas.

## Architecture Decisions

### Decision: Put browser environment detection in the existing public runtime layer

**Choice**: Extend `public/runtime-config.js` into the canonical browser runtime helper for environment detection, emulator settings, API URL resolution, and validation. `public/app.js` should consume this helper before initializing Firebase services.

**Alternatives considered**: Add detection directly in `public/app.js`; add a build-time bundler/env system; split config across multiple inline scripts.

**Rationale**: The repo has no frontend build step and already uses `window.LaCasonaRuntime` for token portal API resolution. Keeping detection in `runtime-config.js` preserves vanilla JS, avoids framework/bundler scope creep, and centralizes runtime decisions instead of scattering host checks across tenant code.

### Decision: Use one public config object as source of truth

**Choice**: Replace ad-hoc globals with a single public runtime config contract loaded by `public/firebase-config.js`, for example `window.__LA_CASONA_PUBLIC_CONFIG__`, containing `mode`, Firebase project config, emulator hosts, Functions region, and explicit fallback policy. Keep temporary backward compatibility with `window.__FIREBASE_CONFIG__` only as a read alias during transition.

**Alternatives considered**: Keep current `window.__FIREBASE_CONFIG__` plus separate globals; derive everything only from `location.hostname`; use Firebase CLI generated config.

**Rationale**: Current config points at production project values while `.firebaserc` points at `demo-alquileres-la-casona`, which is exactly the mixed-state risk. One public object makes validation scriptable and gives local/prod an obvious contract. Host detection is useful as a guard, not as sole source of truth.

### Decision: Connect Firebase Web SDKs to emulators immediately after service creation

**Choice**: In `public/app.js`, initialize `auth`, `db`, `storage`, and `functions` as today, then call runtime-provided emulator connection logic before any auth listener, callable, Firestore read/write, or Storage reference can run.

**Alternatives considered**: Connect emulators lazily in each feature path; use only Hosting `/api` rewrites and skip SDK emulator connections; use production project with test data.

**Rationale**: Tenant flow uses direct Auth, Firestore, Storage, and callable Functions from `app.js`. Lazy/per-feature connection is fragile because early calls like `onAuthStateChanged`, `listAvailableUnits`, and tenant profile creation can run before setup. SDK emulator connection is the safest boundary while preserving existing app code paths.

### Decision: Preserve same-origin `/api/*` for token portal HTTP endpoints

**Choice**: Keep `LaCasonaRuntime.resolveApiUrl()` defaulting to `${location.origin}/api/{functionName}` when served by Firebase Hosting or Hosting Emulator. Use `__FUNCTIONS_BASE_URL__` only for static/non-hosted local contexts, and keep cloudfunctions.net fallback disabled unless explicitly enabled.

**Alternatives considered**: Route token portal calls through callable Functions; always call `http://127.0.0.1:5001/...` in local mode; always call deployed `cloudfunctions.net` in production mode.

**Rationale**: `firebase.json` already rewrites `/api/resolvePaymentAccessToken`, `/api/createCheckoutFromPaymentAccessToken`, `/api/submitTransferFromPaymentAccessToken`, and `/api/verifyPaymentReceipt`. Keeping same-origin preserves the current token portal contract, CORS expectations, and production Hosting behavior while allowing the Hosting Emulator to proxy the same path to Functions Emulator.

### Decision: Fail fast with a blocking UX before tenant flow starts

**Choice**: Add a startup runtime guard that validates config/mode/project/emulator consistency before showing login, tenant onboarding, or token portal screens. On failure, render the existing access-denied/auth-message style with a technical reason and remediation.

**Alternatives considered**: Log warnings only; allow app to start and surface errors from Firebase SDK calls; hide local-only failures in validation scripts.

**Rationale**: Warnings are easy to miss and SDK errors happen after state may already touch wrong resources. A blocking startup failure protects production data and teaches developers immediately what must be fixed.

## Data Flow

### Authenticated tenant/admin SPA startup

```text
index.html
  ├─ firebase-config.js ──→ window.__LA_CASONA_PUBLIC_CONFIG__
  ├─ runtime-config.js  ──→ window.LaCasonaRuntime
  └─ app.js
       ├─ LaCasonaRuntime.assertSafeRuntime()
       ├─ initializeApp(publicConfig.firebase)
       ├─ getAuth/getFirestore/getStorage/getFunctions
       ├─ LaCasonaRuntime.connectEmulatorsIfNeeded(...)
       └─ onAuthStateChanged + tenant/admin flows
```

### Local emulator tenant flow

```text
Browser on 127.0.0.1:5000
  ├─ Auth SDK      ──→ 127.0.0.1:9099
  ├─ Firestore SDK ──→ 127.0.0.1:8080
  ├─ Storage SDK   ──→ 127.0.0.1:9199
  ├─ Callable SDK  ──→ 127.0.0.1:5001/demo-alquileres-la-casona/us-central1/*
  └─ fetch /api/*  ──→ Hosting Emulator rewrite ──→ Functions Emulator HTTP endpoints
```

### Production token portal compatibility

```text
Browser on production Hosting domain
  └─ LaCasonaRuntime.resolveApiUrl("resolvePaymentAccessToken", { token })
       └─ https://<origin>/api/resolvePaymentAccessToken?token=...
            └─ Firebase Hosting rewrite
                 └─ deployed onRequest Function
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `public/firebase-config.js` | Modify | Define the single public runtime config object. Local defaults should use `demo-alquileres-la-casona` and explicit emulator hosts; production values remain representable without changing app code. |
| `public/runtime-config.js` | Modify | Add runtime mode detection, config normalization, safety assertions, emulator descriptor helpers, and keep `resolveApiUrl()` compatible with `/api/*`. |
| `public/app.js` | Modify | Consume runtime helper before Firebase usage and connect Auth/Firestore/Storage/Functions emulators immediately after service initialization. |
| `public/verify-receipt.js` | Modify only if needed | Continue using `LaCasonaRuntime.resolveApiUrl()`; no Firebase SDK emulator work needed because this path uses HTTP `/api/*`. |
| `public/index.html` | Modify only if needed | Keep script order: config → runtime → app. Add no build step. |
| `firebase.json` | Review/modify | Preserve existing Hosting rewrites for token portal `/api/*`; ensure emulator ports match runtime config. |
| `.firebaserc` / `.firebaserc.example` | Review/modify | Keep local default project on demo project. Production project selection must stay explicit and not become local default. |
| `functions/.env.example` | Modify if needed | Keep local `WEBAPP_URL` and `BACKEND_BASE_URL` aligned to Hosting/Functions emulators. |
| `scripts/validate-local-dev.mjs` | Modify | Replace Stage 1 prohibition on emulator connectors with positive assertions for runtime config, connector usage, demo project, `/api` preservation, and no production fallback in local mode. |
| `README.md` | Modify | Document local tenant flow runbook, fail-fast errors, emulator URLs, and token portal `/api` compatibility. |

## Interfaces / Contracts

### Public runtime config shape

```js
window.__LA_CASONA_PUBLIC_CONFIG__ = {
  mode: "local", // "local" | "production"
  firebase: {
    apiKey: "demo-api-key",
    authDomain: "demo-alquileres-la-casona.firebaseapp.com",
    projectId: "demo-alquileres-la-casona",
    storageBucket: "demo-alquileres-la-casona.appspot.com",
    messagingSenderId: "demo",
    appId: "demo"
  },
  emulators: {
    enabled: true,
    host: "127.0.0.1",
    authPort: 9099,
    firestorePort: 8080,
    storagePort: 9199,
    functionsPort: 5001
  },
  functions: {
    region: "us-central1",
    baseUrl: "",
    allowCloudFunctionsFallback: false
  }
};
```

Contract rules:
- Local mode MUST use a demo/local Firebase project id and MUST enable emulator connections.
- Local mode MUST NOT enable `allowCloudFunctionsFallback`.
- Local mode MUST NOT point `functions.baseUrl` at `cloudfunctions.net`.
- Production mode MUST NOT enable emulator connections.
- Runtime helper MUST reject unsupported modes and missing Firebase config before initializing tenant flows.

### Runtime helper surface

```js
window.LaCasonaRuntime = Object.freeze({
  getConfig(),
  getMode(),
  isLocalRuntime(),
  assertSafeRuntime(),
  connectEmulatorsIfNeeded({ auth, db, storage, functions, connectors }),
  resolveApiUrl(functionName, params)
});
```

`connectors` should be passed from `app.js` because Firebase connector functions are ES module imports:

```js
LaCasonaRuntime.connectEmulatorsIfNeeded({
  auth,
  db,
  storage,
  functions,
  connectors: {
    connectAuthEmulator,
    connectFirestoreEmulator,
    connectStorageEmulator,
    connectFunctionsEmulator
  }
});
```

### Fail-fast UX contract

On startup validation failure:
- App MUST NOT attach auth listeners or execute tenant callables.
- App SHOULD show a blocking message in the existing auth/access-denied surface.
- Message SHOULD include mode, detected origin, invalid field, and expected fix.
- Console MAY include structured details for developers.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Static validation | Local config uses demo project, emulator ports, no cloud fallback, and `/api` rewrites remain present | Extend `scripts/validate-local-dev.mjs` assertions. |
| Unit-style runtime validation | `resolveApiUrl`, mode detection, fail-fast invalid combinations | If no browser test harness is introduced, validate by static checks plus small Node-compatible pure helpers only if runtime code is factored for that. |
| Emulator integration | Tenant onboarding uses Auth/Firestore/Functions emulators and token portal fetches same-origin `/api/*` | Manual runbook with `npm run emulators`; inspect Emulator UI and browser network tab. |
| Regression | Production config still resolves `/api/*` from current origin and does not connect emulators | Static validation plus documented manual smoke check before deploy. |

No broad test framework or frontend build tool should be introduced for this slice.

## Migration / Rollout

No data migration required.

Rollout should be done as a local-safety slice:
1. Add runtime contract and validation.
2. Connect SDKs to emulators in local mode.
3. Update docs/runbook.
4. Verify local tenant onboarding and token portal against emulators.

Production rollout risk is low if production mode keeps emulator connections disabled and `/api/*` resolution unchanged. If a production issue appears, rollback is reverting `public/firebase-config.js`, `public/runtime-config.js`, `public/app.js`, validation, and docs from this slice.

## Open Questions

- [ ] Should the local default public config live directly in `public/firebase-config.js`, or should the repo keep `firebase-config.local.example.js` plus a copied ignored local file? Direct default is safer for this repo's current no-build workflow; copied ignored file gives more flexibility but adds setup friction.
- [ ] Should local callable Functions use `connectFunctionsEmulator()` exclusively, or should a runtime guard also validate `functions/_/` network requests during manual QA? The SDK connector should be enough technically, but network validation catches regressions faster.
