# Integraciones y Responsabilidades

## Firebase Hosting

Uso:

- servir el panel administrativo
- publicar una futura vista simple para inquilinos

No guardar:

- secretos de Twilio
- tokens de Mercado Pago
- logica de validacion sensible

## Firebase Authentication

Uso:

- acceso de administradores
- roles por claims custom o perfil en Firestore

Roles sugeridos:

- `owner`
- `admin`
- `operator`
- `viewer`

## Cloud Functions

Funciones HTTP o callable sugeridas:

- `createMonthlyCharges`
- `createMercadoPagoPreference`
- `handleMercadoPagoWebhook`
- `sendDueReminder`
- `sendOverdueReminder`
- `processReceiptUpload`
- `extractUtilityBillData`
- `approveReceiptManually`

## Twilio

Enviar desde backend:

- recordatorio antes del vencimiento
- aviso de mora
- confirmacion de recepcion de comprobante
- confirmacion de pago aprobado

Buenas practicas:

- plantillas por tipo de aviso
- logs por envio
- opt-in claro para WhatsApp
- limite de reintentos

## Mercado Pago

Ideal para:

- cobrar alquiler puntual
- cobrar alquiler + servicios
- generar un link por uno o varios cargos

Buenas practicas:

- relacionar `external_reference` con ids internos
- confiar en webhook mas que en respuesta del frontend
- registrar estado bruto recibido del proveedor
- contemplar pagos pendientes, rechazados y acreditados

## Validacion de comprobantes

Arquitectura sugerida:

1. upload a Storage
2. trigger de Function
3. OCR
4. normalizacion de texto
5. deteccion de monto
6. comparacion contra cargos pendientes
7. resultado automatico o cola de revision

## Lectura de facturas

Campos utiles a extraer:

- empresa emisora
- servicio
- periodo
- fecha de vencimiento
- importe total
- identificador del suministro

Regla practica:

si el OCR no detecta con buena confianza el importe o la fecha, el sistema no deberia imputar automaticamente el cargo.
