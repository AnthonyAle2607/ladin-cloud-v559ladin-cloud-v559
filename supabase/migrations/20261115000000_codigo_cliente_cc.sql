-- Código de cliente correlativo CC-001, CC-002… (como las etiquetas).
-- Renumera a TODOS los clientes que aún no tienen un código CC-###, por orden de registro, a continuación del mayor
-- CC que ya exista. El código anterior se guarda en codigo_anterior: con él el cliente puede seguir entrando a la app.
-- Se puede aplicar varias veces: la segunda vez no cambia nada (todos ya tienen CC-###).

alter table public.clientes add column if not exists codigo_anterior varchar(50);
create index if not exists ix_clientes_codigo_anterior on public.clientes (upper(codigo_anterior));

-- 1) Guardar el código que tenían (solo la primera vez).
update public.clientes
   set codigo_anterior = codigo_cliente
 where codigo_anterior is null
   and codigo_cliente is not null and btrim(codigo_cliente) <> ''
   and codigo_cliente !~* '^CC-[0-9]+$';

-- 2) Renumerar los que no tienen CC-###.
with base as (
  select coalesce(max((substring(codigo_cliente from '(?i)^CC-([0-9]+)$'))::int), 0) as mayor
    from public.clientes
   where codigo_cliente ~* '^CC-[0-9]+$'
), orden as (
  select id, row_number() over (order by fecha_registro, id) as rn
    from public.clientes
   where codigo_cliente is null or codigo_cliente !~* '^CC-[0-9]+$'
)
update public.clientes c
   set codigo_cliente = 'CC-' || case when b.mayor + o.rn < 1000 then lpad((b.mayor + o.rn)::text, 3, '0') else (b.mayor + o.rn)::text end,
       fecha_actualizacion = current_timestamp
  from orden o, base b
 where c.id = o.id;
