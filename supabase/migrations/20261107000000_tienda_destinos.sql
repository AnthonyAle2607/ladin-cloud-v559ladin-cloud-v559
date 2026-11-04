-- Destinos de entrega iniciales de la tienda. En Vercel el servidor no crea datos al arrancar, así que sin esto la
-- lista queda vacía y nadie puede confirmar una compra. Solo se insertan si la tabla está vacía: si ya hay destinos
-- (creados en el panel → Productos → Destinos), no se toca nada. Costos y días se ajustan después en el panel.
insert into public.tienda_destinos (nombre, costo_usd, dias_extra, requiere_direccion, orden)
select d.nombre, d.costo_usd, d.dias_extra, d.requiere_direccion, d.orden
from (values
  ('Retiro en Valencia', 0::numeric, 0, false, 0),
  ('Caracas', 6::numeric, 3, true, 1),
  ('Maracaibo', 12::numeric, 5, true, 2)
) as d(nombre, costo_usd, dias_extra, requiere_direccion, orden)
where not exists (select 1 from public.tienda_destinos);
