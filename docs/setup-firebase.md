# Setup Firebase

## Lo que ya quedo preparado

El proyecto ya tiene:

- configuracion base de Firebase
- reglas de Firestore
- reglas de Storage
- indices de Firestore
- estructura de `Cloud Functions` en TypeScript
- placeholders para Mercado Pago, Twilio y Claude

Proyecto Firebase ya definido:

- `projectId`: `alquileres-la-casona`
- `authDomain`: `alquileres-la-casona.firebaseapp.com`
- `dominio publico`: `https://alquilereslacasona.com.ar`
- `storageBucket`: `alquileres-la-casona.firebasestorage.app`

## Carpetas importantes

- `functions/src/modules/`: logica del backend separada por dominio
- `functions/src/lib/`: helpers comunes
- `functions/src/index.ts`: exporta las funciones
- `firestore.rules`: permisos de datos
- `storage.rules`: permisos de archivos
- `firestore.indexes.json`: indices recomendados

## Variables de entorno

Copiar `functions/.env.example` y completar:

- `WEBAPP_URL`
- `BACKEND_BASE_URL`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `CLAUDE_API_KEY`
- `WHATSAPP_CLOUD_API_TOKEN` (opcional)
- `WHATSAPP_PHONE_NUMBER_ID` (opcional)
- `WHATSAPP_BUSINESS_ACCOUNT_ID` (opcional)
- `FINANCIAL_BOT_API_URL` (opcional)
- `FINANCIAL_BOT_API_SECRET` (opcional)

## Primer acceso

Cuando abras la aplicacion con una cuenta nueva:

1. crea la cuenta o inicia sesion
2. si todavia no existe un administrador inicial, aparecera el bloque:
   `Convertirme en admin inicial`
3. ese paso crea el primer `superadmin` del proyecto

Ese camino de bootstrap queda habilitado solo mientras no exista `settings/bootstrap`.

Los permisos actuales de Firestore toman el rol desde `users/{uid}`.
Eso permite empezar a trabajar sin depender todavia de custom claims.

En `Storage` hay una solucion transitoria orientada a que la subida de comprobantes funcione ya.
Cuando conectemos custom claims para roles, conviene endurecer esas reglas.

## Flujo actual de inquilino

1. el admin crea el inquilino con su correo real y propiedad asignada
2. el backend genera `tenantInvitations/{correo-normalizado}` como invitacion canonica
3. el inquilino crea su cuenta o inicia sesion con ese mismo correo
4. en el primer login, `claimTenantAccess` vincula `users/{uid}`, custom claims y `tenantId`

No hace falta enviar email automatico todavia. En esta etapa la invitacion funciona por coincidencia de correo.

El alta self-service por tipo/codigo de propiedad queda deshabilitada: si no hay invitacion activa, la app debe mostrar que administracion debe preparar o corregir el acceso.

## Funciones creadas en esta base

### Configuracion

- `upsertGeneralSettings`

### Inquilinos

- `inviteTenantUser`
- `claimTenantAccess`
- `createTenantProfile` (compatibilidad: reclama invitacion existente, no crea perfiles self-service)
- `createTenantAdminProfile`

### Cobros

- `generateMonthlyCharges`
- `scheduledGenerateMonthlyCharges`

### Pagos

- `submitTransferPayment`
- `approveTransferPayment`
- `createMercadoPagoCheckout`
- `handleMercadoPagoWebhook`

### Tokens

- `createPaymentAccessToken`
- `resolvePaymentAccessToken`

### Mensajes

- `sendGeneralMessage`
- `sendDueReminders`

### Documentos

- `extractUtilityBillData`
- `extractPaymentReceiptData`

## Alcance real de esta etapa

Esta etapa deja la estructura tecnica lista para crecer. Hoy ya existen puntos reales para:

- Mercado Pago
- lectura asistida de comprobantes y facturas con Claude

Todavia sigue pendiente la conexion real de:

- Twilio

Mercado Pago ya quedo preparado a nivel codigo, pero para funcionar necesita:

1. `MERCADO_PAGO_ACCESS_TOKEN`
2. `BACKEND_BASE_URL` apuntando a la URL publica del backend que expone `handleMercadoPagoWebhook` (no sirve una URL local para produccion)
3. deploy de `Cloud Functions`

Claude ya puede analizar comprobantes y facturas desde `Cloud Functions`, pero para que responda de verdad necesita:

1. `CLAUDE_API_KEY`
2. deploy actualizado de `Cloud Functions`
3. disparar el analisis desde la revision admin

El analisis de Claude no aprueba pagos por si solo. Solo completa datos sugeridos para la revision humana.

## Proximo paso recomendado

Construir la capa real de autenticacion y datos del panel:

1. login con roles
2. CRUD de propiedades
3. CRUD de inquilinos
4. listado real de cobros
5. portal base del inquilino conectado a Firestore
