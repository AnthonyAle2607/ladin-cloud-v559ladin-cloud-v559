-- 1) Cada etiqueta guarda la asesora que la trabajó (la del cliente cuando se creó). Así, al reasignar la cartera, las
--    etiquetas, estadísticas y comisiones anteriores siguen siendo de quien las hizo; las nuevas son de la asesora nueva.
alter table public.etiquetas add column if not exists asesora_id integer references public.usuarios(id) on delete set null;
create index if not exists idx_etiquetas_asesora on public.etiquetas(asesora_id);

-- Las etiquetas que ya existen quedan con la asesora actual de su cliente (no hay otro dato del pasado).
update public.etiquetas e
set asesora_id = c.asesora_id
from public.clientes c
where c.id = e.cliente_id and e.asesora_id is null;

-- 2) Fecha de llegada a Venezuela de los contenedores: la cobranza cuenta los días desde ahí. Los contenedores que ya
--    están en Venezuela, entregados o cerrados toman su fecha estimada (o hoy, si no tienen o si es futura); el
--    administrador la corrige en el contenedor si fue otra.
update public.contenedores
set fecha_llegada = least(coalesce(fecha_estimada, current_date), current_date)
where estado in ('ve', 'done', 'closed') and fecha_llegada is null;
