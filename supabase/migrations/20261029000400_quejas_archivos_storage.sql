-- Adjuntos de incidencias en Supabase Storage (necesario en Vercel, donde el disco es de solo lectura).
-- Cada archivo recuerda su almacén: 'disco' (anteriores) o 'supabase' (nuevos).
alter table queja_archivos add column if not exists almacen varchar(10) not null default 'disco'
  check (almacen in ('disco', 'supabase'));

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('quejas-archivos', 'quejas-archivos', false)
    on conflict (id) do nothing;
  end if;
end $$;