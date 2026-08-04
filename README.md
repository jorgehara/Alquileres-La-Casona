# Alquileres La Casona

Base inicial para una web de administracion de cobros de alquileres de departamentos y otras propiedades.

## Objetivo

Centralizar en una sola aplicacion:

- gestion de propiedades, unidades e inquilinos
- control de contratos y vencimientos
- seguimiento de cobros y deuda
- envio automatico de recordatorios por WhatsApp o SMS con Twilio
- validacion de comprobantes de pago
- lectura y control de facturas de servicios
- pago con tarjeta mediante Mercado Pago

## Stack propuesto

- `Firebase Hosting` para servir la app web
- `Firestore` para datos operativos
- `Firebase Authentication` para acceso de administradores
- `Cloud Functions` para integraciones seguras con terceros
- `Cloud Storage` para guardar comprobantes y facturas
- `Twilio` para comunicaciones automaticas
- `Mercado Pago` para links/preferencias de pago y webhooks

## Estructura inicial

- `public/`: app web inicial lista para Hosting
- `docs/`: arquitectura funcional y tecnica
- `firebase.json`: configuracion base de Firebase
- `firestore.rules`: reglas base de acceso
- `storage.rules`: reglas base para archivos

## Estado actual

Ya hay un MVP visual y funcional en `public/`:

- resumen operativo
- alta de propiedades
- alta de unidades
- alta de inquilinos
- alta de contratos
- generacion de cobros del mes
- registro de pagos
- exportacion de datos en JSON

Por ahora funciona en modo demo local y guarda la informacion en el navegador.

## Como probarlo

1. abrir `public/index.html` en el navegador
2. recorrer las secciones del menu lateral
3. cargar una propiedad, una unidad, un inquilino y un contrato
4. usar `Generar cobros del mes`
5. ir a `Cobros` y registrar un pago

## Proximo objetivo tecnico

Conectar este MVP a Firebase para que los datos dejen de quedar solo en tu navegador y pasen a una base real compartida.

## Modulos sugeridos

1. Panel de administracion
2. Inquilinos y contratos
3. Cobros y conciliacion
4. Facturas de luz y agua
5. Comunicaciones automaticas
6. Pagos con Mercado Pago
7. Auditoria y reportes

## Siguiente paso recomendado

Implementar primero el flujo minimo:

1. alta de propiedad, unidad e inquilino
2. generacion mensual de deuda
3. carga de comprobante
4. validacion manual asistida
5. recordatorio automatico de vencimiento

Luego sumar:

1. webhook de Mercado Pago
2. validacion automatica de comprobantes
3. lectura automatica de facturas

## Desarrollo local con emuladores Firebase

Prerequisitos: Node.js 20, npm 10 y JDK 21 o superior para emuladores que usan Java. No hace falta instalar Firebase CLI globalmente: el repo usa `firebase-tools` versionado en el `package.json` raíz.

Desde la raíz del repo:

```bash
npm install
npm run install:functions
cp functions/.env.example functions/.env.alquileres-la-casona
npm run build:functions
npm run emulators
```

El archivo `.firebaserc.example` usa `demo-alquileres-la-casona`; si necesitás `.firebaserc`, copialo desde el ejemplo y mantenelo sin versionar. Esta guía local no agrega flujo de login ni deploy.

Puertos esperados: Hosting `http://127.0.0.1:5000`, Emulator UI `http://127.0.0.1:4000`, Functions `http://127.0.0.1:5001/demo-alquileres-la-casona/us-central1`, Firestore `8080`, Auth `9099`, Storage `9199`.

Al abrir `http://127.0.0.1:5000`, Auth, Firestore, Storage y Functions usan emuladores. Si el runtime detecta proyecto productivo, puertos faltantes o fallback a `cloudfunctions.net` en modo local, bloquea el inicio antes de autenticar o tocar datos.

Runbook completo: `docs/local-tenant-emulator-flow.md`.
