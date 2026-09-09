# Tutorial: modo contingencia y cargo manual del mes

Este tutorial explica cómo probar y usar las dos herramientas administrativas nuevas del sistema: **Cargo manual del mes** y **Modo contingencia**. Están pensadas para casos excepcionales donde el sistema estuvo caído, hubo mantenimiento, falló internet o el inquilino pagó pero no pudo cargar el comprobante por el flujo normal.

> Estas acciones son solo para administradores y superadministradores. Los inquilinos no pueden usarlas.

## Resumen rápido

Usá este orden cuando no exista una cuota/cobro para el mes:

1. Entrar como administrador.
2. Ir a **Cargo manual del mes**.
3. Crear el cobro del período correspondiente.
4. Ir a **Modo contingencia**.
5. Cargar el comprobante, fecha, monto y motivo.
6. Confirmar que el cobro quedó **Pagado**.

Si el cobro ya existe, salteá el paso de **Cargo manual del mes** y usá directamente **Modo contingencia**.

---

## Caso 1: crear un cargo manual del mes

Usá esta opción cuando el sistema no generó el cobro mensual y necesitás crear la cuota manualmente.

### Pasos

1. Iniciar sesión como **admin** o **superadmin**.
2. En el menú lateral, abrir **Cargo manual del mes**.
3. Completar:
   - **Inquilino / unidad**: seleccionar el inquilino correspondiente.
   - **Período**: seleccionar el mes que se quiere cobrar.
   - **Fecha de vencimiento**: indicar cuándo vencía ese cobro.
   - **Monto del cargo**: cargar el monto base que debe quedar como cuota del mes.
   - **Motivo administrativo**: explicar por qué se crea manualmente.
4. Presionar **Crear cargo manual**.

### Resultado esperado

El sistema debe mostrar un mensaje de éxito y crear un cobro nuevo en estado **Pendiente**.

### Error esperado si ya existe

Si aparece:

```text
Ya existe un cobro para ese inquilino y período.
```

significa que ese cobro ya está creado. No es un error del sistema: es una protección para evitar duplicar deuda. En ese caso, ir directamente a **Modo contingencia**.

---

## Caso 2: cargar un comprobante en modo contingencia

Usá esta opción cuando el inquilino ya pagó, pero no pudo cargar el comprobante por mantenimiento, falla de internet, caída del sistema o un bug.

### Pasos

1. Iniciar sesión como **admin** o **superadmin**.
2. En el menú lateral, abrir **Modo contingencia**.
3. Seleccionar el **inquilino / unidad**.
4. Presionar **Cargar comprobante en contingencia**.
5. En la ventana de carga:
   - Elegir el **cobro** correspondiente.
   - Cargar el **monto informado**. Este monto será la fuente de verdad del cobro.
   - Seleccionar la **fecha del pago/comprobante**.
   - Subir el archivo del comprobante.
   - Confirmar que **Modo contingencia** esté activo.
   - Completar el **motivo de contingencia**.
6. Presionar **Aprobar pago en contingencia**.

### Resultado esperado

El sistema debe:

- crear un pago aprobado;
- asociar el comprobante al pago;
- marcar el cobro como **Pagado**;
- reemplazar el total del cobro por el monto cargado por administración;
- guardar auditoría con el usuario, fecha, monto y motivo.

---

## Ejemplo de prueba para Enzo

### Escenario

Un inquilino pagó agosto, pero no pudo cargar el comprobante porque el sistema estaba en mantenimiento.

### Prueba recomendada

1. Buscar si ya existe el cobro de agosto para ese inquilino.
2. Si no existe:
   - abrir **Cargo manual del mes**;
   - crear el cargo para agosto;
   - cargar un monto de prueba;
   - guardar con motivo: `Prueba de generación manual por contingencia`.
3. Abrir **Modo contingencia**.
4. Seleccionar el mismo inquilino.
5. Elegir el cobro de agosto.
6. Cargar:
   - monto real transferido;
   - fecha real del comprobante;
   - archivo del comprobante;
   - motivo: `Prueba de carga por contingencia`.
7. Confirmar.

### Verificación

Después de confirmar, revisar que:

- el cobro figure como **Pagado**;
- el monto del cobro sea el monto tipeado por administración;
- el pago figure como aprobado;
- el comprobante quede asociado;
- no quede pendiente de revisión normal.

---

## Reglas importantes

| Regla | Qué significa |
|---|---|
| Solo admin/superadmin | Los inquilinos no pueden crear cargos manuales ni usar contingencia. |
| No duplica cobros | Si ya existe un cobro para el mismo inquilino y período, no permite crear otro. |
| El monto tipeado manda | En contingencia, el monto cargado por administración reemplaza el total del cobro. |
| La fecha tipeada manda como fecha de pago | La fecha del comprobante se guarda como fecha pagada/reportada. |
| La aprobación queda auditada | El sistema guarda quién hizo la acción, cuándo y por qué. |

---

## Cuándo usar cada opción

| Situación | Opción correcta |
|---|---|
| No existe el cobro del mes | Primero **Cargo manual del mes** |
| El cobro existe pero el comprobante no se pudo cargar | **Modo contingencia** |
| El inquilino puede cargar normalmente | No usar contingencia; usar flujo normal |
| Se quiere corregir un caso excepcional ya validado por administración | **Modo contingencia** |

## Advertencia operativa

No usar estas herramientas para pagos normales. Son herramientas de excepción para corregir casos donde el sistema no pudo registrar correctamente una operación real ya verificada por administración.
