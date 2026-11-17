-- Área de la etiqueta: estado de Venezuela al que va el envío (23 estados + Distrito Capital).
-- Se imprime en la casilla 区域 de la etiqueta PNG como «número · estado» (1 Distrito Capital, resto alfabético; ver areas.js).
-- Las etiquetas que ya existen toman el estado de su cliente. Se puede aplicar varias veces.

alter table public.etiquetas add column if not exists area_destino varchar(40);

update public.etiquetas e
   set area_destino = c.estado_venezuela
  from public.clientes c
 where c.id = e.cliente_id
   and e.area_destino is null
   and c.estado_venezuela in ('Distrito Capital', 'Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar',
     'Carabobo', 'Cojedes', 'Delta Amacuro', 'Falcón', 'Guárico', 'La Guaira', 'Lara', 'Mérida', 'Miranda', 'Monagas',
     'Nueva Esparta', 'Portuguesa', 'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia');
