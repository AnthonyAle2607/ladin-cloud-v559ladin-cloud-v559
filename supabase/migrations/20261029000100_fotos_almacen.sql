-- Las fotos de las etiquetas pueden estar en disco local ('disco') o en Supabase Storage ('supabase').
-- Cada fila recuerda dónde quedó su archivo, así las fotos viejas y las nuevas conviven sin migrar de golpe.
alter table etiqueta_fotos add column if not exists almacen varchar(10) not null default 'disco'
  check (almacen in ('disco', 'supabase'));
