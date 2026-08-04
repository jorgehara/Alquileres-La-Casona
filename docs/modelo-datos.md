# Modelo de Datos Inicial

## `properties`

Representa una propiedad madre.

Campos sugeridos:

- `name`
- `type` (`building`, `house`, `commercial`)
- `address`
- `notes`
- `isActive`
- `createdAt`

## `units`

Una unidad alquilable dentro de una propiedad.

Campos sugeridos:

- `propertyId`
- `code`
- `label`
- `type`
- `baseRent`
- `currency`
- `includesUtilities`
- `isActive`

## `tenants`

Datos del inquilino o responsable de pago.

Campos sugeridos:

- `fullName`
- `documentId`
- `phone`
- `email`
- `preferredChannel` (`whatsapp`, `sms`, `email`)
- `mercadoPagoCustomerId` opcional
- `notes`

### Onboarding de inquilinos

El alta de acceso del inquilino queda gobernada por administración:

1. Un admin crea el documento `tenants/{tenantId}` con la propiedad asignada y, si hay correo, deja `invitationStatus: "pending"`.
2. El sistema crea/actualiza `tenantInvitations/{emailNormalizado}`. El correo normalizado en minúsculas es la clave canónica de reclamo.
3. El inquilino inicia sesión o crea cuenta con ese mismo correo y la Function `claimTenantAccess` vincula `users/{uid}`, custom claims y estados de invitación.

Estados soportados:

- `pending`: invitación preparada, todavía no reclamada.
- `claimed`: acceso vinculado correctamente.
- `accepted`: valor histórico tratado como equivalente de `claimed` al leer.
- `revoked`: acceso revocado; no puede reclamarse automáticamente.
- `self_registered`: valor histórico tolerado; no se usa para nuevas altas.

`tenantInvitations/{emailNormalizado}` mantiene esta forma compatible:

- `tenantId`
- `email`
- `displayName`
- `status` (`pending`, `claimed`, `accepted`, `revoked`)
- `userId` opcional
- `createdAt`, `createdBy`, `updatedAt`
- `claimedAt`, `claimedBy`
- `legacyInvitationToken`, `legacyInvitationId` o `migratedFromLegacyId` cuando el reclamo viene de datos históricos.

Los documentos antiguos con ID tipo token solo se aceptan como lectura/reparación si contienen un único `email` + `tenantId` no ambiguo. No son una segunda autoridad de reclamo.

## `users/{uid}` como autoridad de acceso

`users/{uid}` es la fuente canónica para autorización de la app:

- `role`: `superadmin`, `admin` o `tenant`.
- `status`: `active`, `inactive` o `disabled`; si no está presente en datos históricos se trata como `active` por compatibilidad.
- `tenantId`: obligatorio para `tenant` y no autoriza roles administrativos.
- `ownerScope`: `all`, `enzo` o `ivo` para admins; `superadmin` siempre opera como `all`.

Custom claims de Firebase Auth son una proyección derivada desde `users/{uid}`. Se mantienen para compatibilidad con Storage rules y para refresco de sesión, pero Functions y Firestore rules no deben conceder permisos más amplios por claims viejos.

## `leases`

Contrato vigente o historico.

Campos sugeridos:

- `propertyId`
- `unitId`
- `tenantId`
- `startDate`
- `endDate`
- `dueDay`
- `monthlyRent`
- `depositAmount`
- `status` (`draft`, `active`, `finished`, `cancelled`)
- `lateFeePolicy`

## `charges`

Cada importe a cobrar.

Campos sugeridos:

- `leaseId`
- `tenantId`
- `unitId`
- `period`
- `type` (`rent`, `water`, `electricity`, `penalty`, `other`)
- `description`
- `amount`
- `currency`
- `dueDate`
- `status` (`pending`, `partially_paid`, `paid`, `overdue`, `cancelled`)
- `source` (`manual`, `generated`, `utility_bill`)
- `createdAt`

## `payments`

Registro de pago o intento de pago.

Campos sugeridos:

- `tenantId`
- `chargeIds`
- `method` (`bank_transfer`, `cash`, `mercado_pago`)
- `grossAmount`
- `netAmount`
- `paidAt`
- `status` (`reported`, `processing`, `approved`, `rejected`)
- `receiptId`
- `mercadoPagoPaymentId` opcional
- `reconciliationStatus`

## `receipts`

Comprobantes subidos.

Campos sugeridos:

- `storagePath`
- `tenantId`
- `uploadedAt`
- `ocrText`
- `detectedAmount`
- `detectedDate`
- `detectedReference`
- `validationStatus` (`pending`, `validated`, `needs_review`, `rejected`)
- `validationNotes`

## `utilityBills`

Facturas de servicios.

Campos sugeridos:

- `unitId`
- `serviceType` (`water`, `electricity`)
- `period`
- `provider`
- `amount`
- `dueDate`
- `storagePath`
- `extractionStatus`
- `linkedChargeId`

## `notifications`

Historial de avisos enviados.

Campos sugeridos:

- `tenantId`
- `leaseId`
- `chargeId`
- `channel`
- `templateKey`
- `status`
- `sentAt`
- `providerMessageId`

## `paymentLinks`

Links o preferencias generadas para cobrar.

Campos sugeridos:

- `tenantId`
- `chargeIds`
- `provider` (`mercado_pago`)
- `externalId`
- `initPoint`
- `status`
- `expiresAt`

## Subcolecciones opcionales

Si luego queres mas trazabilidad:

- `leases/{leaseId}/events`
- `payments/{paymentId}/audit`
- `tenants/{tenantId}/contactLog`
