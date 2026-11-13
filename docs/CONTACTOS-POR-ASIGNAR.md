# Contactos por asignar (clientes del sistema anterior)

Migración: `supabase/migrations/20261114000000_contactos_por_asignar.sql` (se puede aplicar varias veces).

## Qué es

Menú «Contactos por asignar», solo para el administrador. Muestra los clientes del sistema anterior (Ladin Cloud)
con **solo nombre, apellido y teléfono**. No se trae nada más: ni código viejo, ni asesora anterior, ni documentos.

## Cómo se usa

1. «Cargar archivo» → elegir el respaldo `.sql` del sistema anterior (o un CSV con columnas nombre, apellido, teléfono).
   El archivo se lee en el navegador; al servidor solo viajan nombre, apellido y teléfono. Los datos no quedan en el código.
2. En cada contacto, elegir la asesora en «Asignar a»: en ese momento se crea como cliente de esa asesora, con código
   código `CCCN-G-####` (sede, origen y tipo por defecto) y estado pendiente.
3. Para varios a la vez: marcarlos, elegir la asesora en «Asignar marcados a…» y «Asignar marcados».
4. «Descartar» los que no sirvan (se pueden recuperar en la pestaña Descartados).

## Repetidos

- Al cargar: se salta un contacto si ya está cargado con el mismo teléfono y el mismo nombre completo (dos personas
  pueden compartir un teléfono). Cargar el archivo otra vez no duplica nada.
- Si ya es cliente (mismo teléfono y mismo primer nombre; sin teléfono, mismo nombre completo), no se carga ni se crea
  de nuevo; al asignarlo, se marca como asignado al cliente que ya existe.

## Rutas

- `GET /api/contactos?estado=pendiente|asignado|descartado|todos`
- `POST /api/contactos/cargar` `{ contactos: [{ nombre, apellido, telefono }] }`
- `POST /api/contactos/asignar` `{ ids, advisorId }`
- `PUT /api/contactos/:id` `{ estado: 'descartado' | 'pendiente' }`
