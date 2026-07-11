# Roadmap de Desarrollo

## Fase 1 - Base operativa

Objetivo:

tener una base segura del sistema para poder crear usuarios, unidades y cobros.

Incluye:

- autenticacion con roles
- invitacion de inquilinos
- propiedades
- inquilinos
- configuracion general
- modelo de cobros
- dashboard admin basico

Resultado esperado:

el administrador ya puede preparar el sistema y generar deudas.

## Fase 2 - Portal del inquilino

Objetivo:

dar visibilidad y autoservicio al inquilino.

Incluye:

- portal Mi alquiler
- detalle del cobro vigente
- historial de cobros y pagos
- actualizacion de telefono y email
- contacto con administracion

Resultado esperado:

el inquilino ya puede consultar su situacion sin depender de mensajes manuales.

## Fase 3 - Transferencias y comprobantes

Objetivo:

recibir pagos por transferencia con control seguro.

Incluye:

- vista de datos bancarios
- registro de pago reportado
- upload de hasta dos comprobantes
- lectura asistida con Claude
- cola de revision admin
- aprobacion y rechazo manual

Resultado esperado:

la administracion puede revisar pagos reportados con trazabilidad.

## Fase 4 - Mercado Pago

Objetivo:

habilitar pago online con actualizacion automatica.

Incluye:

- generacion de preferencia o link
- checkout
- webhook
- validacion interna
- actualizacion de estados

Resultado esperado:

el inquilino puede pagar online y el sistema concilia automaticamente.

## Fase 5 - Link unico por token

Objetivo:

simplificar acceso al cobro puntual.

Incluye:

- generacion de token seguro
- pagina publica de cobro
- vencimiento de token
- pago y comprobante desde token

Resultado esperado:

se puede cobrar de forma simple incluso sin pasar por navegacion completa.

## Fase 6 - Facturas y automatizacion

Objetivo:

mejorar la carga operativa y la comunicacion.

Incluye:

- carga de facturas
- extraccion asistida con Claude
- asociacion a cobros
- mensajes automaticos con Twilio
- historial de mensajes

Resultado esperado:

el sistema pasa de ser solo un panel de cobro a una herramienta administrativa completa.

## Fase 7 - Cierre y madurez

Objetivo:

fortalecer el producto para uso real continuo.

Incluye:

- auditoria completa
- endurecimiento de permisos
- mejoras de usabilidad
- refinamiento visual
- reportes utiles
- control de errores

Resultado esperado:

producto estable, mantenible y listo para crecer.

## Prioridad recomendada

Orden sugerido:

1. Fase 1
2. Fase 2
3. Fase 3
4. Fase 4
5. Fase 5
6. Fase 6
7. Fase 7

## Lo que conviene no postergar

- roles y permisos
- separacion entre cobro, pago y comprobante
- estado `en_revision`
- configuracion general en backend
- webhook seguro para Mercado Pago
