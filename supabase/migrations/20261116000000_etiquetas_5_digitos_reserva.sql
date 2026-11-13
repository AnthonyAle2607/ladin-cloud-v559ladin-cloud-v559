-- Etiquetas: correlativo de 5 dígitos (00001, 00002…) y reserva del siguiente número por 5 minutos.
-- Se puede aplicar varias veces.

-- 1) Reserva: al abrir «Nueva etiqueta» el panel reserva el siguiente número para esa persona durante 5 minutos;
--    nadie más lo recibe mientras tanto. Si no guarda a tiempo, la reserva vence y el número vuelve a quedar libre.
create table if not exists public.reservas_etiqueta (
  numero      varchar(30) primary key,
  usuario_id  integer not null,
  creado_en   timestamp not null default current_timestamp,
  vence_en    timestamp not null
);
create index if not exists reservas_etiqueta_usuario_idx on public.reservas_etiqueta(usuario_id);
alter table public.reservas_etiqueta enable row level security;
revoke all on public.reservas_etiqueta from anon, authenticated;

-- 2) Las etiquetas que ya tienen número correlativo conservan su número, solo pasan a 5 dígitos (0001 → 00001,
--    0001-2 → 00001-2). Si ya existiera el número de 5 dígitos, esa etiqueta se deja como está.
update public.etiquetas e
   set numero = lpad(e.numero, 5, '0')
 where e.numero ~ '^[0-9]{1,4}$'
   and not exists (select 1 from public.etiquetas x where x.numero = lpad(e.numero, 5, '0'));

update public.etiquetas e
   set numero = lpad(split_part(e.numero, '-', 1), 5, '0') || substring(e.numero from '-[0-9]+$')
 where e.numero ~ '^[0-9]{1,4}-[0-9]+$'
   and not exists (select 1 from public.etiquetas x where x.numero = lpad(split_part(e.numero, '-', 1), 5, '0') || substring(e.numero from '-[0-9]+$'));

-- 3) Etiqueta PNG: el área es 1 (Caracas) y se quita «Negocio» (业务), que repetía el código del asesor.
update public.ajustes
   set valor = ((valor::jsonb - 'negocio') || '{"area":"1"}'::jsonb)::text,
       actualizado_en = current_timestamp
 where clave = 'etiqueta_almacen' and valor is not null;
