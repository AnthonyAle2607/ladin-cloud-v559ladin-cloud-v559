-- Nuevo almacén en China (Enping, Jiangmen, Guangdong): responsable y dirección que salen en la etiqueta PNG.
-- Reemplaza los responsables y la dirección guardados; conserva el resto (guías, nota). Se puede aplicar varias veces.

insert into public.ajustes (clave, valor)
values ('etiqueta_almacen', '{}')
on conflict (clave) do nothing;

update public.ajustes
   set valor = (coalesce(nullif(valor, ''), '{}')::jsonb
                || jsonb_build_object(
                     'responsables', jsonb_build_array(jsonb_build_object('nombre', '余生', 'telefono', '15976460367')),
                     'direccion', '广东省江门市恩平市东成镇淘金路2号（华达工业园）临街商铺3号横槎红绿灯旁利侨委国贷运'))::text,
       actualizado_en = now()
 where clave = 'etiqueta_almacen';
