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
