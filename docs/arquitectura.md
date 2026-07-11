# Arquitectura Propuesta

## Vision general

La solucion se apoya en Firebase como plataforma principal y reserva las integraciones externas para `Cloud Functions`, de modo que los secretos y la logica sensible no queden expuestos en el navegador.

## Componentes

### 1. Frontend

- app administrativa servida por `Firebase Hosting`
- interfaz operativa para administrar alquileres, deudas, comprobantes y comunicaciones
- acceso restringido por rol

### 2. Firestore

Colecciones principales:

- `properties`
- `units`
- `tenants`
- `leases`
- `charges`
- `payments`
- `receipts`
- `utilityBills`
- `notifications`
- `paymentLinks`

### 3. Cloud Storage

Almacenamiento de:

- comprobantes de pago subidos por usuarios o administracion
- PDF o imagenes de facturas de luz y agua

### 4. Cloud Functions

Responsabilidades:

- crear preferencias o links de pago en Mercado Pago
- recibir webhooks de Mercado Pago
- enviar mensajes por Twilio
- ejecutar tareas programadas de recordatorio
- procesar OCR y validacion de comprobantes
- extraer montos y fechas de facturas de servicios

## Flujos principales

### Flujo A: Cobro mensual

1. una tarea programada genera el cargo mensual desde un contrato activo
2. el sistema marca fecha de vencimiento
3. si faltan pocos dias, una funcion envia recordatorio por Twilio
4. si vence sin pago, el sistema escala el tono del aviso y registra seguimiento

### Flujo B: Pago con Mercado Pago

1. el administrador genera una solicitud de cobro
2. una Cloud Function crea la preferencia o link de pago
3. el inquilino paga con tarjeta o medios disponibles
4. Mercado Pago envia webhook
5. la funcion valida firma y estado
6. se actualiza el cobro en Firestore y se registra la conciliacion

### Flujo C: Comprobante de transferencia

1. el inquilino sube un comprobante
2. el archivo se guarda en Storage
3. una funcion toma el archivo y extrae texto y metadatos con OCR
4. se compara el monto leido con el cargo pendiente
5. se marca estado:
   - `validated`
   - `needs_review`
   - `rejected`
6. se genera una notificacion interna si hay diferencias

### Flujo D: Facturas de luz y agua

1. se sube la factura o se ingresa manualmente
2. el sistema extrae periodo, vencimiento y monto
3. el monto se asocia a la unidad correspondiente
4. se suma como cargo complementario o se deja pendiente de aprobacion

## Validacion de comprobantes

Para este modulo conviene separar tres capas:

### Extraccion

- OCR sobre imagen o PDF
- deteccion de monto, fecha, cuenta de destino y referencia

### Reglas de negocio

- tolerancia de centavos o redondeos
- validacion contra deuda total o parcial
- validacion contra contrato/unidad
- deteccion de pagos duplicados

### Revision humana

- cola de casos dudosos
- interfaz para aprobar, corregir o rechazar

## Seguridad

- autenticacion obligatoria para administradores
- roles por usuario
- secretos solo en entorno de Functions
- webhooks validados con firma
- reglas estrictas para Firestore y Storage
- auditoria de cambios en cobros, contratos y aprobaciones

## Integraciones

### Twilio

Usos sugeridos:

- recordatorio previo al vencimiento
- aviso de pago vencido
- confirmacion de pago aprobado
- pedido de reenvio cuando el comprobante no coincide

Canales:

- WhatsApp si la cuenta lo permite
- SMS como respaldo

### Mercado Pago

Usos sugeridos:

- preferencias de pago por contrato o cargo
- pagos con tarjeta de credito y debito
- webhooks para confirmacion automatica

### OCR y lectura documental

Opciones tecnicas:

- `Google Cloud Vision`
- `Document AI`
- servicio tercero especializado

Para una primera version, conviene empezar con OCR simple + validacion asistida, y pasar a extraccion mas robusta cuando tengamos suficientes ejemplos reales.

## Roadmap tecnico

### Fase 1

- panel administrativo
- CRUD de propiedades, unidades e inquilinos
- contratos y cargos mensuales
- carga de comprobantes
- recordatorios simples

### Fase 2

- Mercado Pago con webhook
- OCR de comprobantes
- aprobacion manual asistida
- facturas de servicios

### Fase 3

- automatizaciones mas finas
- reportes de mora y cobranza
- portal liviano para inquilinos
