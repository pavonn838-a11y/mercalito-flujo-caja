# Mercalito - Flujo de caja diario

Aplicacion web simple para controlar vencimientos diarios de eCheq y cheques fisicos.

## Que permite hacer

- Importar archivos Excel `.xls` y `.xlsx`.
- Detectar si el archivo corresponde a eCheq o cheque fisico.
- Leer `Fecha de Pago` e importe de cada cheque.
- Agrupar vencimientos por dia.
- Cargar saldo inicial del banco por dia.
- Cargar ingresos estimados por tarjetas, Mercado Pago, efectivo, transferencias y otros.
- Calcular diferencia diaria.
- Mostrar semaforo verde, amarillo o rojo.
- Ver resumen de proximos 3, 7, 15, 30 y 360 dias.
- Ver detalle cheque por cheque.
- Exportar la planilla diaria a Excel.
- Guardar la informacion en SQLite local.

## Requisitos

- Node.js 24.
- npm.

## Instalacion

Desde esta carpeta:

```bash
npm run install:all
```

## Correr en modo desarrollo

```bash
npm run dev
```

Luego abrir:

```text
http://localhost:5173
```

Si preferis correrlo en dos terminales:

```bash
npm run dev:backend
npm run dev:frontend
```

El backend queda disponible en:

```text
http://localhost:3001
```

## Base de datos

La base SQLite se crea automaticamente en:

```text
backend/data/mercalito.sqlite
```

Para reiniciar los datos locales, cerrar la app y borrar ese archivo.

## Uso rapido

1. Subir un Excel de eCheq o cheques fisicos.
2. Revisar los vencimientos diarios en la pantalla principal.
3. Cargar saldo inicial e ingresos estimados para cada fecha.
4. Revisar el semaforo y la diferencia diaria.
5. Exportar a Excel cuando necesites compartir o archivar la informacion.

Los cheques y eCheq vencidos recientes se muestran como vencimiento de manana para que no se pierdan en el flujo. La app arrastra solo los ultimos 360 dias vencidos, asi no mezcla historiales de anos anteriores con la caja de manana.

## Columnas esperadas en Excel

La app busca una columna llamada `Fecha de Pago`, `Dia de Pago` o nombres parecidos como `Fecha Pago`, `Dia Pago`, `Vencimiento` o `Fecha de Vencimiento`.

Para el importe busca columnas como `Importe`, `Monto`, `Valor`, `Total` o `Importe Cheque`.

Si hay columnas como `Numero`, `Nro Cheque`, `Banco`, `CUIT`, `Proveedor`, `Beneficiario` o `Estado`, tambien las guarda para el detalle.

## Publicar online

La app esta preparada para publicarse como un solo servicio web en Render.

Configuracion recomendada:

```text
Build Command: npm run render:build
Start Command: npm start
Health Check Path: /api/health
```

Variables necesarias:

```text
NODE_ENV=production
DATA_DIR=/var/data
APP_USER=usuario-para-entrar
APP_PASSWORD=clave-segura
```

Para que los datos no se pierdan al reiniciar o actualizar el servicio, agregar un disco persistente:

```text
Mount Path: /var/data
Size: 1 GB
```

La app tambien incluye `render.yaml`, que Render puede leer como Blueprint. Al publicarla, Render va a entregar un link `https://...onrender.com` que se puede abrir desde cualquier computadora, sin que esta Mac este prendida.
