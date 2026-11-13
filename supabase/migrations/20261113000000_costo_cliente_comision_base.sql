-- 1) Costo acordado con el cliente al crear la etiqueta (monto total en USD). La factura lo usa como monto de la
--    línea de esa etiqueta y, de ahí, la comisión.
alter table public.etiquetas add column if not exists costo_cliente_usd numeric(12,2) check (costo_cliente_usd is null or costo_cliente_usd >= 0);

-- 2) Línea de factura con monto acordado (si viene, reemplaza CBM × tarifa marítima).
alter table public.factura_items add column if not exists monto_acordado numeric(12,2) check (monto_acordado is null or monto_acordado >= 0);

-- 3) Comisión sobre una tarifa base por CBM más baja que la cobrada: nuevo tipo de regla y su tarifa.
alter table public.comision_reglas drop constraint if exists comision_reglas_tipo_check;
alter table public.comision_reglas add constraint comision_reglas_tipo_check
  check (tipo in ('porcentaje_total', 'porcentaje_flete', 'fijo_cbm', 'porcentaje_tarifa_base'));
alter table public.comision_reglas add column if not exists tarifa_base numeric(10,2) check (tarifa_base is null or tarifa_base >= 0);

-- 4) Ajustes del sistema que cambia el administrador (por ahora, los datos fijos de la etiqueta del almacén de Yiwu).
create table if not exists public.ajustes (
  clave         varchar(80) primary key,
  valor         text,
  actualizado_en timestamp not null default current_timestamp
);
alter table public.ajustes enable row level security;
revoke all on public.ajustes from anon, authenticated;
