# Arquitectura Tecnica Final

## Stack principal

- `Firebase Hosting`
- `Firebase Authentication`
- `Firestore`
- `Firebase Storage`
- `Cloud Functions`
- `Twilio`
- `Mercado Pago`
- `Claude`

## Principios de arquitectura

- logica de negocio centralizada en backend
- frontend orientado a visualizacion y captura de acciones
- permisos definidos por rol
- archivos protegidos y versionados con metadatos
- estructura modular para crecer sin rehacer la base

## Frontend

La aplicacion tendra tres superficies:

### 1. Admin app

Uso:

- dashboard
- gestion operativa
- revision de pagos
- configuracion

### 2. Tenant app

Uso:

- portal Mi alquiler
- historial
- pagos
- comprobantes
- contacto

### 3. Public payment page

Uso:

- acceso por token a un cobro especifico
- detalle del cobro
- pago
- comprobante

## Backend

Toda la logica sensible vivira en `Cloud Functions`.

Tipos de funciones:

- `callable` para acciones desde la app autenticada
- `http` para webhooks y links por token
- `scheduled` para recordatorios y tareas periodicas

## Recomendacion tecnica cerrada

### Functions

Enfoque recomendado:

- `callable` para acciones internas
- `http` para:
  - webhook de Mercado Pago
  - accesos por token
  - futuros endpoints de integracion
- `scheduled` para:
  - generar recordatorios
  - revisar mora
  - generar cobros

### Firestore

Enfoque recomendado:

- modelo mixto, priorizando legibilidad
- separacion clara entre entidades principales
- desnormalizacion controlada solo para lectura rapida

### Storage

Enfoque recomendado:

- convencion estricta de carpetas
- metadatos obligatorios
- control de acceso por rol y por pertenencia

Rutas sugeridas:

- `utility-bills/{propertyId}/{billId}/original`
- `payment-receipts/{tenantId}/{paymentId}/{fileId}`
- `contracts/{leaseId}/{fileId}`
- `message-attachments/{messageId}/{fileId}`

## Entidades principales

## Usuarios y roles

### `users`

Representa al usuario autenticado.

Campos:

- `role` (`superadmin`, `admin`, `tenant`)
- `displayName`
- `email`
- `phone`
- `tenantId` opcional
- `status`

## Propiedades y ocupacion

### `properties`

Campos:

- `name`
- `unitCode`
- `unitType`
- `status`
- `sortOrder`
- `notes`
- `currentTenantId`

### `tenants`

Campos:

- `fullName`
- `dni`
- `phone`
- `email`
- `propertyId`
- `baseRent`
- `contractStartDate`
- `contractEndDate`
- `status`
- `invitationStatus`

## Configuracion

### `settings/general`

Campos sugeridos:

- `lateFeeDailyRate`
- `lateFeeCapEnabled`
- `lateFeeCapValue`
- `reminderDaysBeforeDue`
- `bankAccountHolder`
- `bankAlias`
- `bankCbu`
- `enabledPaymentMethods`
- `defaultMessageTemplates`

### `settings/propertyGroups`

Para bloques o grupos de departamentos.

## Cobros y pagos

### `charges`

Representa la deuda de un periodo.

Campos:

- `tenantId`
- `propertyId`
- `period`
- `items`
- `subtotal`
- `lateFeeAmount`
- `total`
- `dueDate`
- `status`
- `paymentPolicy`
- `generatedBy`
- `generatedAt`

`items` contendra al menos:

- `rent`
- `electricity`
- `water`
- `other`

### `payments`

Representa un intento o confirmacion de pago.

Campos:

- `tenantId`
- `chargeId`
- `method` (`transfer`, `mercado_pago`)
- `amountReported`
- `amountConfirmed`
- `status` (`reported`, `in_review`, `approved`, `rejected`, `provider_confirmed`)
- `createdAt`
- `approvedAt`
- `approvedBy`
- `mercadoPagoPaymentId` opcional
- `mercadoPagoStatus` opcional

### `paymentReceipts`

Representa los archivos comprobantes.

Campos:

- `paymentId`
- `tenantId`
- `storagePath`
- `fileType`
- `uploadOrder`
- `claudeExtractionStatus`
- `detectedAmount`
- `detectedDate`
- `matchScore`
- `reviewSuggestion`

## Facturas

### `utilityBills`

Campos:

- `propertyId`
- `serviceType` (`electricity`, `water`)
- `provider`
- `invoiceNumber`
- `period`
- `dueDate`
- `amount`
- `storagePath`
- `claudeStatus`
- `createdAt`
- `confirmedBy`

## Mensajeria

### `messages`

Campos:

- `tenantId` opcional
- `propertyId` opcional
- `channel`
- `type`
- `templateKey`
- `body`
- `status`
- `sentAt`
- `createdBy`
- `twilioMessageSid`

## Auditoria

### `auditLogs`

Campos:

- `actorUserId`
- `actorRole`
- `targetType`
- `targetId`
- `action`
- `before`
- `after`
- `createdAt`

Registrar como minimo:

- cambios de importes
- aprobacion o rechazo de pagos
- cambios de configuracion

## Seguridad y permisos

## Authentication

Roles:

- `superadmin`
- `admin`
- `tenant`

Alta de inquilinos:

- por invitacion controlada

## Firestore rules

Lineamientos:

- `admin` y `superadmin` pueden leer y escribir en la mayoria de las colecciones operativas
- `tenant` solo puede leer:
  - sus propios datos
  - sus cobros
  - sus pagos
  - sus comprobantes
  - sus mensajes
- `tenant` solo puede escribir:
  - sus comprobantes
  - ciertos datos de perfil
  - acciones acotadas de contacto

## Storage rules

Lineamientos:

- facturas: solo admin y superadmin
- comprobantes: upload solo por el inquilino dueño del pago o por admin
- contratos y documentos: solo admin

## Integraciones

## Mercado Pago

Flujo seguro:

1. frontend solicita crear pago
2. function genera preferencia o link
3. frontend redirige
4. webhook recibe notificacion
5. function consulta o valida el pago
6. si corresponde, actualiza `payments` y `charges`

Decision tomada:

- un cobro se marca `pagado` solo con webhook aprobado y validacion interna

## Twilio

Canal prioritario:

- WhatsApp

Tipos de envio:

- recordatorio previo
- vencido
- deuda prolongada
- pago recibido
- aviso general

## Claude

Uso:

- extraer monto de facturas
- extraer monto de comprobantes
- sugerir coincidencia

Limitacion:

- Claude no aprueba pagos ni modifica estados finales por si solo

## Token links

Estrategia:

- token largo aleatorio
- fecha de expiracion
- acceso restringido a un cobro concreto
- invalidez manual si hace falta
