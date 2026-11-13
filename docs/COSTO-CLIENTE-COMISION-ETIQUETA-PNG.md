# Costo acordado, comisión por tarifa base, correlativo y etiqueta PNG

Migración: `supabase/migrations/20261113000000_costo_cliente_comision_base.sql` (se puede aplicar varias veces).
Sin ella el panel sigue funcionando, pero no guarda el costo ni la tarifa base y la etiqueta PNG usa los datos por defecto.

## 1. Número de etiqueta correlativo (5 dígitos, con reserva)

Migración: `supabase/migrations/20261116000000_etiquetas_5_digitos_reserva.sql`.

- El número tiene 5 dígitos (00001, 00002…) y no se escribe a mano: lo pone el sistema.
- Al abrir «Nueva etiqueta» se **reserva** el siguiente número para quien lo abrió y se muestra con una cuenta regresiva
  de 5 minutos. Mientras tanto nadie más recibe ese número (el que abra después recibe el siguiente).
- Al guardar dentro de los 5 minutos, la etiqueta queda con el número reservado. Si la reserva vence, el número queda
  libre; al guardar se asigna el siguiente libre (o se puede pulsar «Reservar otra vez»).
- Cerrar el formulario sin guardar suelta la reserva enseguida.
- Se toma el mayor número que sea solo dígitos entre las etiquetas principales y se le suma 1. Los números viejos con
  letras (ET-72352…) no cuentan.
- Las etiquetas que ya tenían número conservan su número y pasan a 5 dígitos (0001 → 00001, 0001-2 → 00001-2).
- Las subetiquetas se numeran desde la principal (00001-1, 00001-2…).
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

- Botón «Etiqueta PNG» en el detalle de la etiqueta principal y al editarla (las subetiquetas no la tienen). Muestra la vista previa, permite ajustar cajas y
  mercancía, y «Descargar PNG» (o «Compartir» en el teléfono).
- «Negocio» (业务) se quitó: repetía el código del asesor, que ya sale en 客服编号.
- Variables: 客服编号 = código del asesor, 客户编号 = código del cliente, 单据编号 = número de etiqueta, 箱数 = cajas,
  名称 = mercancía.
- Fijos (responsables y teléfonos, dirección, 区域 = área —1 es Caracas—, 票数, nota): `GET/PUT /api/ajustes/etiqueta-almacen`,
  tabla `ajustes`. Solo el administrador los cambia («Datos fijos del almacén…» dentro del modal).
- Se dibuja en el navegador (canvas 1240 × 1754) con las fuentes chinas del sistema; no pasa por el servidor.
