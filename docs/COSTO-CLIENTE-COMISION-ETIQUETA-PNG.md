# Costo acordado, comisión por tarifa base, correlativo y etiqueta PNG

Migración: `supabase/migrations/20261113000000_costo_cliente_comision_base.sql` (se puede aplicar varias veces).
Sin ella el panel sigue funcionando, pero no guarda el costo ni la tarifa base y la etiqueta PNG usa los datos por defecto.

## 1. Número de etiqueta correlativo

- Al crear una etiqueta principal ya no se escribe el número: el sistema pone el siguiente (0001, 0002…).
- Se toma el mayor número que sea solo dígitos entre las etiquetas principales y se le suma 1. Los números viejos con letras
  (ET-72352…) no cuentan.
- Si dos personas crean a la vez y chocan, el servidor toma el siguiente número (hasta 4 reintentos).
- Las subetiquetas siguen numerándose desde la principal (0001-1, 0001-2…).
- Al editar, el número se puede corregir a mano como antes.

## 2. Costo acordado con el cliente

- Campo «Costo acordado con el cliente (USD)» al crear o editar la etiqueta: el total que la asesora le dio al cliente.
- Columna `etiquetas.costo_cliente_usd`.
- En «Nueva factura», al agregar la etiqueta pendiente, la línea trae ese monto en la columna «Acordado $».
  Si la línea tiene monto acordado, ese es el flete (reemplaza CBM × $/CBM); se le suman terrestre y extra.
  Se guarda en `factura_items.monto_acordado`.

## 3. Comisión por tarifa base

- Nuevo tipo de regla: «Porcentaje sobre una tarifa base por CBM (más baja que la cobrada)».
- Comisión = CBM × tarifa base × %. Ej.: 3 CBM, tarifa base $500, 10 % → $150 (sobre el flete de $660 serían $198).
- La regla global debe llevar tarifa base; la de cada asesor puede tener la suya o usar la de la global.
- La tarifa base debe ser menor que la tarifa marítima ($660).
- Necesita el CBM en la línea de la factura: sin CBM la comisión sale en $0.
- Con «Porcentaje del flete marítimo», si la línea tiene monto acordado, el % se aplica a ese monto.

## 4. Etiqueta PNG (formato almacén de Yiwu)

- Botón «Etiqueta PNG» en el detalle de la etiqueta y al editarla. Muestra la vista previa, permite ajustar cajas y
  mercancía, y «Descargar PNG» (o «Compartir» en el teléfono).
- Variables: 客服编号 = código del asesor, 客户编号 = código del cliente, 单据编号 = número de etiqueta, 箱数 = cajas,
  名称 = mercancía.
- Fijos (responsables y teléfonos, dirección, 区域, 业务(VE), 票数, nota): `GET/PUT /api/ajustes/etiqueta-almacen`,
  tabla `ajustes`. Solo el administrador los cambia («Datos fijos del almacén…» dentro del modal).
- Se dibuja en el navegador (canvas 1240 × 1754) con las fuentes chinas del sistema; no pasa por el servidor.
