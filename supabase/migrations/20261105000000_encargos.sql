-- «Pídelo de China» (encargos.js): nuevo tipo de solicitud «encargo» y fotos de las solicitudes.
alter table web_solicitudes drop constraint if exists web_solicitudes_tipo_check;
alter table web_solicitudes add constraint web_solicitudes_tipo_check check (tipo in ('reserva', 'contacto', 'aviso_producto', 'encargo'));

create table if not exists web_solicitud_fotos (
  id serial primary key,
  solicitud_id integer not null references web_solicitudes(id) on delete cascade,
  nombre_guardado varchar(255) not null,
  mime_type varchar(60) not null,
  almacen varchar(10) not null default 'disco' check (almacen in ('disco', 'supabase')),
  creado_en timestamp not null default current_timestamp
);
create index if not exists web_solicitud_fotos_solicitud_idx on web_solicitud_fotos(solicitud_id);

-- Solo el servidor (clave secreta) lee y escribe; el navegador nunca habla con la base.
do $$
begin
  alter table web_solicitud_fotos enable row level security;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on web_solicitud_fotos from anon;
    revoke all on sequence web_solicitud_fotos_id_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on web_solicitud_fotos from authenticated;
    revoke all on sequence web_solicitud_fotos_id_seq from authenticated;
  end if;
end $$;
