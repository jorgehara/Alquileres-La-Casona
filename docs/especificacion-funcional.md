# Especificacion Funcional

## Resumen del producto

La aplicacion sera una plataforma web responsiva para administrar alquileres de un complejo de departamentos u otras unidades. Tendra dos experiencias principales:

- panel de administracion
- portal del inquilino

Ademas, existira un acceso puntual por token o link unico para consultar y pagar un cobro especifico.

El objetivo del sistema es centralizar la gestion de alquileres, servicios, pagos, comprobantes y comunicaciones, reduciendo trabajo manual y mejorando la claridad tanto para la administracion como para los inquilinos.

## Tipos de usuario

### Administrador

Puede ver y gestionar toda la informacion del sistema.

Responsabilidades:

- gestionar unidades y propiedades
- gestionar inquilinos
- definir configuraciones generales
- revisar cobros del mes
- cargar facturas
- revisar comprobantes
- aprobar o rechazar pagos
- enviar mensajes generales
- controlar historial y metricas

### Inquilino

Solo puede ver y operar sobre sus propios datos.

Responsabilidades:

- consultar su estado actual
- ver cobros pendientes y pagados
- ver facturas asociadas
- pagar con Mercado Pago
- informar pagos por transferencia
- subir hasta dos comprobantes
- revisar historial
- actualizar email y telefono
- comunicarse con la administracion

## Experiencias principales

## Panel de administracion

La navegacion sera mixta y el inicio tendra dashboard.

Secciones principales:

- dashboard
- propiedades
- inquilinos
- cobros
- facturas
- mensajes
- configuracion

### Dashboard de administracion

Debe mostrar como minimo:

- cobros pendientes
- cobros vencidos
- cobros pagados
- recaudacion del mes
- mora total
- proximos vencimientos
- historial reciente de mensajes enviados

### Propiedades

Permite crear, editar, desactivar y consultar unidades.

Datos base:

- nombre o numero de unidad
- tipo de unidad
- estado
- orden interno
- observaciones
- inquilino actual

### Inquilinos

Permite crear, editar, desactivar y consultar inquilinos.

Datos base:

- nombre y apellido
- DNI
- telefono
- email
- unidad asignada
- alquiler base
- fecha de inicio de contrato
- fecha de fin de contrato
- estado activo o inactivo

### Cobros

Es el modulo central.

Vista principal:

- tabla filtrable

Cada cobro mensual puede incluir:

- alquiler base
- luz
- agua
- mora
- otros conceptos
- total
- fecha de vencimiento
- estado

El sistema generara los cobros de forma automatica, pero con supervision del administrador.

Estados recomendados del cobro:

- `pendiente`
- `vencido`
- `en_revision`
- `pagado`
- `cancelado`

Aunque la seleccion inicial del producto no marco todos estos estados, se incluye `en_revision` porque es necesario para el flujo de comprobantes.

### Facturas

El administrador podra cargar facturas de:

- luz
- agua

Cada factura debe:

- almacenar el archivo original
- guardar metadatos
- vincularse a una unidad
- poder vincularse luego a un cobro mensual

Datos utiles:

- proveedor
- numero de factura
- periodo
- fecha de vencimiento
- monto
- archivo

### Mensajes

El administrador podra:

- enviar avisos generales
- consultar historial de mensajes automaticos
- revisar mensajes relacionados con vencimientos o deuda

### Configuracion

El sistema tendra una seccion editable solo por administradores autorizados.

Configuraciones requeridas:

- mora diaria
- dias previos para recordatorio
- datos bancarios
- plantillas de mensajes
- grupos o bloques de unidades
- ajustes o actualizaciones de alquiler
- metodos de pago habilitados

Los cambios sensibles quedaran reservados a superadmin.

## Portal del inquilino

Sera una experiencia completa, no solo una pantalla unica.

La pagina principal del inquilino mostrara:

- estado actual del alquiler
- total adeudado
- detalle del cobro activo
- vencimiento
- acciones de pago

Secciones del portal:

- estado actual
- detalle del cobro
- facturas
- pagos realizados
- comprobantes enviados
- datos personales
- mensajes o contacto con administracion

El inquilino podra:

- ver informacion
- pagar
- subir comprobantes
- actualizar email y telefono
- contactar a la administracion

## Portal por token o link unico

Habra un acceso puntual para consultar y pagar un cobro especifico sin navegar toda la aplicacion.

Ese portal debe mostrar:

- periodo
- detalle de importes
- total
- vencimiento
- pago con Mercado Pago
- pago por transferencia
- carga de comprobantes

El acceso por token sera temporal y seguro.

## Reglas de negocio

## Cobro

Un cobro representa la deuda de un periodo.

Ejemplo:

- alquiler
- luz
- agua
- mora
- otros conceptos

El cobro no es lo mismo que el pago ni que el comprobante.

## Pago

Un pago representa un intento o confirmacion de dinero ingresado.

Puede ser:

- por transferencia
- por Mercado Pago
- parcial o total, segun configuracion

## Comprobante

Un comprobante es un archivo subido por el inquilino.

Se podran subir hasta dos comprobantes por pago informado por transferencia.

## Pagos parciales

Se permitiran solo si la configuracion del sistema o el administrador lo habilitan.

## Mora

La mora sera automatica y configurable.

Se contemplara al menos:

- porcentaje de mora diaria
- posibilidad de topes o reglas adicionales

## Flujo de transferencia

1. el inquilino consulta el monto adeudado
2. ve los datos bancarios
3. realiza la transferencia
4. sube uno o dos comprobantes
5. el sistema registra el pago en estado preliminar
6. Claude intenta leer el monto
7. si coincide, el sistema marca alta confianza pero no aprueba por si solo
8. el administrador revisa y aprueba o rechaza

## Flujo de Mercado Pago

1. el inquilino elige pagar con Mercado Pago
2. el backend genera una preferencia o link
3. el usuario completa el checkout
4. Mercado Pago envia webhook al backend
5. el backend valida el evento
6. el sistema actualiza el estado a `pagado`

## Flujo de facturas

1. el administrador sube una factura
2. Claude extrae el monto
3. el sistema propone o crea un borrador preliminar
4. el administrador confirma
5. la factura queda asociada a una unidad y eventualmente a un cobro

Si Claude no puede extraer correctamente, no se guarda una lectura automatica.

## Mensajeria automatica

Se enviaran mensajes automaticos por WhatsApp como canal principal.

Casos:

- recordatorio previo al vencimiento
- aviso de pago vencido
- aviso de deuda prolongada
- aviso general del administrador
- confirmacion de pago recibido

El historial completo de envios lo ve el administrador. El inquilino ve solo la parte relevante para el.

## Seguridad funcional

El frontend no podra:

- aprobar pagos
- modificar importes criticos
- marcar un cobro como pagado por si solo
- alterar configuraciones sensibles
- validar definitivamente comprobantes

Todas las decisiones sensibles se ejecutaran en backend.
