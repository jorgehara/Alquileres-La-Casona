# Local Firebase Tenant Isolation Specification

## Purpose

Define safe local tenant-flow behavior so browser, Firebase services, and backend endpoints run against emulator-backed resources during local development while production behavior remains unchanged outside emulator mode.

## Requirements

### Requirement: Local Tenant Flows Use Emulator-Backed Firebase

When local emulator mode is enabled, tenant-facing browser flows MUST use emulator-backed Firebase Auth, Firestore, Storage, and callable/function endpoints. Local tenant testing MUST NOT require or read production Firebase data.

#### Scenario: Browser tenant flow runs locally

- GIVEN the app is opened in local emulator mode
- WHEN a tenant signs in and exercises tenant data, file, or endpoint flows
- THEN Auth, Firestore, Storage, and function calls MUST target emulator-backed services
- AND no production Firebase service MAY be contacted for that flow

#### Scenario: Local tenant state is independent

- GIVEN local emulator mode has seeded or user-created tenant test state
- WHEN tenant data is read, written, or files are referenced
- THEN the results MUST come from local emulator state
- AND absence of production data MUST NOT block local tenant-flow execution

### Requirement: Local Runtime Fails Fast on Unsafe Configuration

When local emulator mode is enabled, the runtime MUST detect missing emulator configuration, mixed emulator/production targets, or production project identifiers before tenant flows execute. Unsafe configuration MUST fail fast with an actionable error instead of continuing silently.

#### Scenario: Missing emulator target blocks startup

- GIVEN local emulator mode is enabled
- WHEN any required Firebase service target is missing or unavailable
- THEN the app MUST block tenant-flow execution
- AND the error MUST identify the unsafe or missing local service boundary

#### Scenario: Production target is rejected locally

- GIVEN local emulator mode is enabled
- WHEN runtime configuration points Auth, Firestore, Storage, or functions to production
- THEN the app MUST fail before tenant authentication, reads, writes, uploads, or endpoint calls occur
- AND no production request MAY be attempted

#### Scenario: Mixed local and production targets are rejected

- GIVEN some Firebase services point to emulators and another points to production
- WHEN the local tenant flow initializes
- THEN the runtime MUST treat the configuration as unsafe
- AND tenant-flow execution MUST stop with an actionable misconfiguration error

### Requirement: Production Behavior Remains Unchanged Outside Emulator Mode

When local emulator mode is not enabled, existing production runtime behavior MUST be preserved. The isolation rules MUST NOT change the Firebase stack, production project selection, tenant UX, business permissions, data schema, or deployed endpoint behavior.

#### Scenario: Production mode uses existing production services

- GIVEN the app runs outside local emulator mode
- WHEN a tenant signs in and uses tenant flows
- THEN Firebase Auth, Firestore, Storage, and function calls MUST follow the current production configuration
- AND emulator-only fail-fast checks MUST NOT block valid production execution

#### Scenario: Stack and business behavior are preserved

- GIVEN the isolation boundary is applied
- WHEN the system runs outside local emulator mode
- THEN Firebase Hosting, Vanilla JS, Cloud Functions, Firestore, Auth, and Storage MUST remain the active stack
- AND tenant invitations, permissions, booking behavior, and schemas MUST remain behaviorally unchanged
