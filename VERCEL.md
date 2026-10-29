# Publicar el panel en Vercel

El panel (servidor Express + pantalla web en `public/`) corre en Vercel como **función sin servidor**: `api/index.js` carga `server.js` sin `listen`, y `vercel.json` reenvía `/api/*`, `/f/*`, `/descargas/*` y cualquier otra ruta a esa función. La carpeta `public/` va dentro de la función y además se publica como archivos estáticos (`outputDirectory`), de modo que la pantalla web carga aunque falle una de las dos vías.

## 1. Aplicar el esquema en Supabase (una vez)

En Vercel el servidor **no crea tablas al arrancar**; el esquema viene de `supabase/migrations/`. En Supabase → *SQL Editor* ejecuta, en orden, los archivos que aún no hayas aplicado:

1. `20261029000000_esquema_inicial.sql`
2. `20261029000100_fotos_almacen.sql`
3. `20261029000200_facturacion_comisiones.sql`
4. `20261029000300_cliente_cedula.sql`
5. **`20261029000400_quejas_archivos_storage.sql`** (columna `almacen` en los adjuntos y el bucket privado `quejas-archivos`)

Todos se pueden ejecutar más de una vez sin problema.

## 2. Crear el proyecto en Vercel

1. *Add New… → Project* e importa el repositorio `ladin-cloud-v559ladin-cloud-v559` (rama `main`, o la rama que quieras publicar).
2. **Framework Preset: Other.** No cambies el comando de build ni la carpeta de salida: `vercel.json` ya fija la carpeta de salida (`public`). **Root Directory:** la raíz del repositorio.
3. Antes de desplegar, añade las variables de entorno (sección siguiente).

## 3. Variables de entorno (Settings → Environment Variables)

Solo para **Production**. No las marques como «All Environments»: las vistas previas (*Preview*) usarían tu base de datos real.

| Variable | Valor |
|---|---|
| `JWT_SECRET` | secreto largo, mínimo 32 caracteres (obligatoria; sin ella el servidor se detiene). Genera uno con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATABASE_URL` | cadena de Supabase del **Transaction pooler** (puerto 6543): `postgresql://postgres.<ref>:<clave>@aws-1-<región>.pooler.supabase.com:6543/postgres` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | clave secreta de Supabase (`sb_secret_…`). Solo en el servidor |
| `PUBLIC_URL` | el dominio final con HTTPS, por ejemplo `https://panel.tudominio.com` (se usa en los enlaces de las facturas) |
| `APP_WHATSAPP` | opcional: número con código de país para el botón «Escribir a mi asesora» de la app |

**No hacen falta** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` ni `SUPABASE_JWKS_URL`: son de otra aplicación (el dashboard de Competencia, que está hecho con Next.js). Este panel no usa Supabase Auth ni la clave pública; tiene su propio login.

`NODE_ENV` lo pone Vercel solo. El administrador ya existe en tu base; si empezaras con una base vacía, define también `ADMIN_EMAIL` y `ADMIN_PASSWORD` para el primer arranque.

## 4. Desplegar y comprobar

Despliega y abre el dominio de Vercel: debe aparecer la pantalla de acceso. En *Deployments → Functions → Logs* no debe haber errores. Prueba entrar, abrir un cliente y descargar una factura en PDF.

## Límites de Vercel que conviene conocer

- **Archivos de hasta 4.5 MB por solicitud.** Las fotos de etiquetas se reducen solas en el navegador (1600 px, JPEG) para entrar en ese límite; en las incidencias y en la importación de Excel, un archivo mayor de 4.5 MB se rechaza con un error 413.
- **Sin disco.** Fotos y adjuntos van a Supabase Storage (buckets `etiquetas-fotos` y `quejas-archivos`, privados). El servidor sirve cada archivo con la sesión de quien lo pide.
- **Tiempo máximo de 30 s por solicitud** (configurado en `vercel.json`). Las copias de seguridad en CSV con muchísimos datos podrían tardar más.
- **Conexiones a la base:** cada instancia usa un pool de 2. Por eso la cadena debe ser la del pooler (6543), no la directa.
- **Límite de intentos de login:** se cuenta por instancia, no de forma global. Es una protección parcial; el bloqueo real contra fuerza bruta sería con un servicio externo.
- **Dominio propio:** en *Settings → Domains*. Pon ese mismo dominio en `PUBLIC_URL`.