# Runbook: tenant flow local con emuladores

Objetivo: probar login/onboarding de inquilinos y rutas públicas sin tocar Firebase productivo.

## Arranque seguro

Desde la raíz:

```bash
npm install
npm run install:functions
cp functions/.env.example functions/.env.alquileres-la-casona
npm run build:functions
npm run emulators
```

Abrí `http://127.0.0.1:5000`. No uses el dominio productivo para pruebas locales.

## Puertos esperados

| Servicio | Local |
|---|---|
| Hosting | `http://127.0.0.1:5000` |
| Emulator UI | `http://127.0.0.1:4000` |
| Functions | `http://127.0.0.1:5001/demo-alquileres-la-casona/us-central1` |
| Firestore | `127.0.0.1:8080` |
| Auth | `127.0.0.1:9099` |
| Storage | `127.0.0.1:9199` |

## Qué debe pasar en local

- `public/firebase-config.js` resuelve modo local para `localhost`/`127.0.0.1`.
- `public/app.js` conecta Auth, Firestore, Storage y Functions SDK a emuladores antes de listeners de auth o callables.
- `/api/resolvePaymentAccessToken`, `/api/createCheckoutFromPaymentAccessToken`, `/api/submitTransferFromPaymentAccessToken` y `/api/verifyPaymentReceipt` salen al mismo origen (`127.0.0.1:5000`) y Firebase Hosting Emulator los reescribe a Functions Emulator.
- Si aparece proyecto productivo, falta algún puerto o se intenta usar `cloudfunctions.net` en modo local, la app muestra “Configuración local insegura” y no arranca el tenant flow.

## Smoke manual mínimo

1. En Emulator UI, creá o bootstrappeá un admin local.
2. Desde el panel admin, creá un inquilino con correo real de prueba y propiedad asignada.
3. Verificá en Firestore Emulator que exista `tenantInvitations/{correo-normalizado}` con `status: "pending"` y `tenantId` del inquilino.
4. Cerrá sesión y creá/iniciá sesión con ese mismo correo desde el panel de reclamo de acceso.
5. Verificá que `claimTenantAccess` deje `users/{uid}.role = "tenant"`, custom claims con `tenantId`, `tenantInvitations/{correo}.status = "claimed"` y `tenants/{tenantId}.invitationStatus = "claimed"`.
6. Repetí login del inquilino: debe entrar al portal sin crear otro tenant ni otra invitación.
7. Probá un correo sin invitación: la app debe mostrar que administración debe preparar el acceso y no debe escribir `tenants`, `users` ni `tenantInvitations`.
8. Seed manual de compatibilidad: creá `tenantInvitations/{tokenHistorico}` con `email` + `tenantId` únicos, iniciá sesión con ese correo y verificá que se repare a `tenantInvitations/{correo-normalizado}`.
9. Seed de conflicto: dos tenants activos con el mismo correo o dos invitaciones históricas para el mismo correo deben fallar con `failed-precondition` sin marcar estados `claimed`.
10. Verificá en Network que no haya requests a `alquileres-la-casona.firebaseapp.com`, `firebasestorage.app` ni `cloudfunctions.net` durante login/onboarding local.
11. Si subís comprobantes, revisá Storage Emulator, no Storage productivo.
12. Probá `http://127.0.0.1:5000/verificar-comprobante.html`; las llamadas deben ir a `/api/verifyPaymentReceipt` del mismo origen.

## Contrato de onboarding

- El flujo canonico es invitacion admin + reclamo por correo autenticado.
- `createTenantProfile` queda solo como wrapper compatible para reclamar una invitacion existente; no crea tenants desde seleccion publica de propiedad.
- Los IDs token de invitaciones antiguas se aceptan solo como lectura/reparacion cuando apuntan a un unico correo/tenant activo.

## Verificación de autoridad auth

Ejecutá el verificador no destructivo contra emuladores locales:

```bash
npm run verify:auth-authority
```

El script levanta emuladores con `firebase emulators:exec`, crea usuarios locales para `superadmin/all`, `admin/enzo`, `admin/ivo`, `admin/all`, `tenant`, perfil deshabilitado, perfil faltante y tokens stale. Debe comprobar que Functions y Firestore leen autoridad desde `users/{uid}` y que Storage queda documentado como proyección de claims porque no puede leer Firestore.

Smoke manual adicional: cambiá `users/{uid}.role`, `tenantId`, `ownerScope` o `status`, refrescá la sesión en la app y verificá que la UI no muestre acciones privilegiadas hasta reconciliar token + perfil. Si el token no converge después de refresh, debe ir a acceso denegado o reingreso.

## Producción

Fuera de `localhost`/`127.0.0.1`, el runtime usa el perfil productivo y no conecta emuladores. No cambia rutas, UX, reglas de negocio, permisos ni schema.
