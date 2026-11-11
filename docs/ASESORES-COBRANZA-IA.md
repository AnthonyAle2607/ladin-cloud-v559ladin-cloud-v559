# Asesores, cobranza e IA de documentos (noviembre 2026)

Cambios pedidos en la reunión: código de asesor y asociación de clientes, reasignación de cartera, cobranza,
facturación por asesor, reportes e IA como filtro de documentos.

## Ya existía (sin cambios)

- **Código de asesor**: cada asesora tiene uno único (automático `ASE-001`, editable). Solo el administrador gestiona
  usuarios y códigos (pantalla «Usuarios»).
- **Asesora en el perfil del cliente**: la ficha del cliente y la app móvil muestran su asesora y su código.
- **Reasignar cartera** (administrador): elegir asesora de origen, marcar clientes (o todos) y moverlos a una o
  varias asesoras. Solo cambia la asignación y deja constancia en el historial; no se borra nada.
- No hay un módulo CRM: queda descartado por ahora (ver «Reportes»).

## Nuevo

### Asesora en la etiqueta
- Cada etiqueta guarda su asesora (`etiquetas.asesora_id`): la del cliente cuando se creó. **No cambia al reasignar**:
  las etiquetas, estadísticas y comisiones anteriores siguen siendo de quien las trabajó; las nuevas son de la
  asesora nueva. Si la etiqueta pasa a otro cliente, toma la asesora de ese cliente.
- Se ve en el formulario de la etiqueta («Asesora de la etiqueta: Mariana · ASE-001 · el cliente hoy está con
  Mariel») y en el CSV de etiquetas.
- La **factura y su comisión** van a la asesora de las etiquetas facturadas (si todas son de la misma); si no, a la
  asesora actual del cliente.

### Cobranza desde la llegada a Venezuela
- Los tramos (0-15, 16-30, 31-60, +60) cuentan desde que la mercancía **llega a Venezuela**, no desde la factura:
  fecha de llegada del último contenedor de las etiquetas facturadas.
- Mientras algún contenedor no llega, la factura queda en el tramo **«Por llegar a Venezuela»** (no es atraso).
- Facturas sin etiquetas: la llegada estimada de la factura (si ya pasó) o, si no tiene, la fecha de factura.
- **Fecha de llegada del contenedor**: campo «Llegada real a Venezuela». Si se deja vacío, al marcar «En Venezuela»
  se toma la fecha de hoy; al volver a «En tránsito» se borra.
- La lista se agrupa por cliente **y** asesora: tras una reasignación, cada asesora responde por sus facturas.

### Facturación por asesor
- Desplegable «Todos los asesores / ASE-001 · Mariana…» (solo administrador): la lista y los totales se filtran.
- Resumen «Por asesor» (facturas, facturado, cobrado y por cobrar del período) con «Ver sus facturas».

### Reportes simplificados
- Solo métricas clave, en total y por asesor con su código: **clientes**, **etiquetas creadas en el período** y
  **etiquetas activas** (preparando, en tránsito o en Venezuela). Con un mes elegido, también «clientes nuevos».
- Se quitaron «Clientes viejos reusables» (seguimiento tipo CRM) y la tabla de contenedores. Las exportaciones CSV
  siguen.

### IA: el packing list lo sube el CLIENTE desde la app (no hay IA en el panel)
- **App móvil** («Enviar packing list», desde el inicio o desde una etiqueta): el cliente envía la foto (cámara o
  galería; la app la reduce antes de enviarla) o el Excel del packing list, **con o sin etiqueta**. La IA revisa que sea
  un packing list: si no lo es, se rechaza con un mensaje para el cliente. Si lo es, guarda lo que leyó (cajas, CBM,
  mercancía, proveedor). Si la IA no responde a tiempo, se guarda «sin revisar» para no perder el envío. PDF: pide
  foto o Excel.
- **Panel → Seguimiento → Packing lists**: lo que enviaron los clientes (el administrador ve todo; cada asesora, lo de
  sus clientes), con lo que leyó la IA. Se vincula a una etiqueta o se descarta.
- **Etiqueta → «Packing list del cliente»**: la asesora llena todo a mano y aquí compara con lo que leyó la IA
  (✓ / «No coincide»). «Corregir con el packing list» pone las cifras del documento y muestra el cambio
  («cajas: 10 → 33»): **la IA corrige al que no sabe**. También ofrece vincular los packing lists sin etiqueta.
- **En el panel no hay IA**: se quitó el lector de packing list y el filtro de documentos; las asesoras adjuntan
  documentos libremente.
- Rutas: `POST/GET /api/app/packing` (cliente) y `GET/PUT /api/packing-clientes`, `GET …/:id/archivo` (panel).
  Migración `20261111000000_packing_clientes.sql`. Para la IA usa primero los modelos rápidos y deja el más lento al
  final: responde en 7–8 s.

## Migración

`supabase/migrations/20261110000000_asesor_etiqueta_llegada.sql`: columna `etiquetas.asesora_id` (las existentes
toman la asesora actual de su cliente) y fecha de llegada de los contenedores que ya están en Venezuela, entregados o
cerrados (su fecha estimada, o hoy). Sin la migración el panel funciona, pero las etiquetas no guardan su asesora.

## Pruebas

Contra Postgres 17: 19 comprobaciones del packing list del cliente (IA real) y 30 (asesoras, reasignación, etiquetas, facturas y comisión, cobranza por llegada,
fecha de llegada del contenedor, filtro sin IA) y 5 con la IA real (foto de producto rechazada, packing list leído y
guardado). En el navegador: reportes, facturación por asesor, cobranza, contenedor, etiqueta y la corrección de la IA.
