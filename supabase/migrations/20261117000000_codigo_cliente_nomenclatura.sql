-- Código de cliente: [SEDE][ORIGEN]-[TIPO]-[CORRELATIVO], por ejemplo CCMI-G-0015 (ver codigos.js).
-- Reemplaza a la migración 20261115000000_codigo_cliente_cc.sql (CC-###), que no se debe aplicar.
--
-- Renumera a TODOS los clientes cuyo código no sigue la nomenclatura, por orden de registro, a continuación del mayor
-- correlativo que ya exista, con la sede, el origen y el tipo por defecto: CC (Caracas) + CN (China) + G (general),
-- o sea CCCN-G-0001, CCCN-G-0002… Después se pueden corregir cliente por cliente en su ficha.
-- El código anterior queda en codigo_anterior: con él el cliente puede seguir entrando a la app móvil.
-- Se puede aplicar varias veces: la segunda vez no cambia nada.

alter table public.clientes add column if not exists codigo_anterior varchar(50);
alter table public.clientes add column if not exists codigo_numero integer;
create index if not exists ix_clientes_codigo_anterior on public.clientes (upper(codigo_anterior));

-- 1) Correlativo de los que ya siguen la nomenclatura.
update public.clientes
   set codigo_numero = (substring(codigo_cliente from '-([0-9]+)$'))::int
 where codigo_cliente ~ '^[A-Z]{2}[A-Z]{2}-[A-Z]-[0-9]{4,9}$'
   and codigo_numero is distinct from (substring(codigo_cliente from '-([0-9]+)$'))::int;

-- 2) Guardar el código que tenían los demás (solo la primera vez).
update public.clientes
   set codigo_anterior = codigo_cliente
 where codigo_anterior is null
   and codigo_cliente is not null and btrim(codigo_cliente) <> ''
   and codigo_cliente !~ '^[A-Z]{2}[A-Z]{2}-[A-Z]-[0-9]{4,9}$';

-- 3) Renumerar los que no siguen la nomenclatura.
with base as (
  select coalesce(max(codigo_numero), 0) as mayor from public.clientes
   where codigo_cliente ~ '^[A-Z]{2}[A-Z]{2}-[A-Z]-[0-9]{4,9}$'
), orden as (
  select id, row_number() over (order by fecha_registro, id) as rn
    from public.clientes
   where codigo_cliente is null or codigo_cliente !~ '^[A-Z]{2}[A-Z]{2}-[A-Z]-[0-9]{4,9}$'
)
update public.clientes c
   set codigo_cliente = 'CCCN-G-' || case when b.mayor + o.rn < 10000 then lpad((b.mayor + o.rn)::text, 4, '0') else (b.mayor + o.rn)::text end,
       codigo_numero = b.mayor + o.rn,
       fecha_actualizacion = current_timestamp
  from orden o, base b
 where c.id = o.id;

-- 4) El correlativo es único para todos los clientes (CCMI-G-0015 y VLCN-T-0015 no pueden convivir).
create unique index if not exists ux_clientes_codigo_numero on public.clientes (codigo_numero);
