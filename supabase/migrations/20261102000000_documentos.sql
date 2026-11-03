-- Documentos adjuntos de clientes (cédula, RIF…) y de etiquetas (packing list, fotos de la mercancía y de las cajas…).
create table if not exists documentos (
  id serial primary key,
  entidad varchar(10) not null check (entidad in ('cliente', 'etiqueta')),
  entidad_id integer not null,
  tipo varchar(30) not null,
  nombre_original varchar(255) not null,
  nombre_guardado varchar(255) not null,
  mime_type varchar(100) not null,
  tamano integer not null default 0,
  almacen varchar(10) not null default 'disco' check (almacen in ('disco', 'supabase')),
  usuario_id integer references usuarios(id) on delete set null,
  creado_en timestamp not null default current_timestamp
);
create index if not exists documentos_entidad_idx on documentos(entidad, entidad_id);

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('documentos', 'documentos', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- Igual que el resto de tablas: solo el servidor (con la clave secreta) lee y escribe; el navegador nunca habla con la base.
do $$
begin
  alter table documentos enable row level security;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on documentos from anon;
    revoke all on sequence documentos_id_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on documentos from authenticated;
    revoke all on sequence documentos_id_seq from authenticated;
  end if;
end $$;
