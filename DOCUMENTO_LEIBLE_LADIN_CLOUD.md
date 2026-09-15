# 📦 Contenido Completo de la Base de Datos (ladin_cloud.db)

*Fecha de extracción:* 14/9/2026, 5:49:22 p. m.

## Tabla: `usuarios` (1 registros)

| id | nombre | email | password_hash | rol | activo | codigo_asesora |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Administrador | admin@ladincloud.local | $2b$12$JDeHrEeEFDMNcsoHghWEkONMiC.GUE5aCvSKB9wiSybI6DNtbMC1e | admin | 1 | `null` |

## Tabla: `clientes` (1 registros)

| id | codigo_cliente | nombre | apellido | telefono | email | empresa | asesora_id | estado | estado_venezuela | fecha_primer_contacto | tipo_mercancia | cajas_packing_list | cajas_en_china | cajas_recibidas_venezuela | cbm_packing_list | cbm_real_china | observaciones | fecha_registro | fecha_actualizacion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | LC-CLI-000001 | Corporación | Transoceánica | +584241234567 | logistica@transoceanica.com | Transoceanic S.A. | 1 | process | Carabobo | 2026-09-01 | `null` | `null` | `null` | `null` | `null` | `null` | Cliente importador mayorista de calzado y textiles | 2026-09-14 13:03:34 | 2026-09-14 13:03:34 |

## Tabla: `contenedores` (1 registros)

| id | numero | origen | fecha_salida | fecha_estimada | fecha_llegada | estado | observaciones |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | MSCU-9021482 | Yiwu, China | 2026-09-05 | 2026-10-20 | `null` | transit | Embarque marítimo directo Valencia |

## Tabla: `etiquetas` (1 registros)

| id | numero | cliente_id | contenedor_id | estado | observaciones | lista | tipo_mercancia | cajas_packing_list | cajas_en_china | cajas_recibidas_venezuela | cbm_packing_list | cbm_real_china | familia_codigo | etiqueta_padre_id | tiene_subetiquetas | fecha_llegada_china | fecha_salida_china | fecha_creacion | fecha_actualizacion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | LC-FAM-880 | 1 | 1 | transit | `null` | 0 | Calzado Deportivo | 100 | 60 | `null` | 12.5 | 7.5 | `null` | `null` | 1 | `null` | `null` | 2026-09-14 13:03:34 | 2026-09-14 13:03:34 |

## Tabla: `quejas` (1 registros)

| id | usuario_id | asunto | detalle | prioridad | estado | respuesta | creado_en | respondido_en | fecha_incidencia | codigo_asesor | codigo_cliente | codigo_etiqueta | area_involucrada | evidencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | Inconsistencia en CBM de empaque | El cubicaje real reportado en almacén China difiere en 0.5 CBM con el packing list enviado por proveedor. | alta | respondida | Se verificó con el inspector en Yiwu. El peso/volumen ajustado corresponde al embalaje reforzado con guacales de madera. | 2026-09-14 13:03:34 | 2026-09-14 13:03:34 | 2026-09-12 | `null` | LC-CLI-000001 | LC-FAM-880 | logistica | Fotos de guía física recibida en almacén Yiwu. |

## Tabla: `recordatorios` (0 registros)

*Sin registros*

## Tabla: `notas_equipo` (1 registros)

| id | usuario_id | texto | creado_en |
| --- | --- | --- | --- |
| 1 | 1 | Recordatorio: Revisar despachos de contenedores de Yiwu el viernes. | 2026-09-14 13:03:34 |

## Tabla: `historial` (5 registros)

| id | usuario_id | accion | tabla_afectada | registro_id | descripcion | fecha |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | Cliente LC-CLI-000001 creado | clientes | 1 | Se creó a Corporación Transoceánica. Estado: process. | 2026-09-14 13:03:34 |
| 2 | 1 | Contenedor MSCU-9021482 creado | contenedores | 1 | Se creó el contenedor MSCU-9021482. | 2026-09-14 13:03:34 |
| 3 | 1 | Etiqueta LC-FAM-880 agregada | etiquetas | 1 | Se creó la etiqueta LC-FAM-880. | 2026-09-14 13:03:34 |
| 4 | 1 | Incidencia enviada: Inconsistencia en CBM de empaque | quejas | 1 | Registrada por Administrador. | 2026-09-14 13:03:34 |
| 5 | 1 | Incidencia 1 actualizada | quejas | 1 | Respuesta registrada. | 2026-09-14 13:03:34 |

