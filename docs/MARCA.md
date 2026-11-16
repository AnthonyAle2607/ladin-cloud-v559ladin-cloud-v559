# Identidad visual (Manual de identidad de Criollo Cargo)

Fuente: `ManualIdentidadVisualCriolloCargo1.pdf` y los PNG oficiales (logotipo, isotipo y paleta).

## Colores

| Uso | Color |
|---|---|
| Primario: estructura, barra lateral, fondos oscuros, textos principales | Azul institucional `#001E52` |
| Acento: botones de acción, destaques, opción activa | Naranja `#FF7303` |
| Base: fondos y tarjetas | Blanco `#FFFFFF` (fondo de página `#F2F5FA`) |

Rojo (alertas) y verde (entregado) se mantienen como colores de estado.

## Logotipos (`public/img/marca/`)

- `logo-horizontal.png`: sobre fondos claros (PDF de facturas y recibos, etiqueta PNG del almacén).
- `logo-horizontal-negativo.png`: sobre el azul (barra lateral y pantalla de acceso).
- `isotipo.png` / `isotipo-negativo.png`: espacios reducidos (barra lateral contraída), favicon e íconos.

Reglas del manual: no estirar, comprimir ni inclinar; sin degradados, sombras ni texturas; no cambiar los colores;
no separar el isotipo del texto ni quitar los filetes de «CARGO»; margen libre alrededor equivalente a la «O».
La tipografía Enfolding es exclusiva del logotipo (no se usa en textos de la interfaz).

## Dónde se aplica

- Panel: `public/criollo-theme.css` (tokens), `brandHTML` en `public/app.js`, favicon en `public/index.html`,
  encabezado de PDF en `facturacion.js` (`encabezadoPdf`), etiqueta PNG en `public/etiqueta-png.js`.
- Web (criollo-cargo-web): `src/app/globals.css`, `Navegacion.tsx`, `Pie.tsx`, `src/app/icon.png`.
- App (caribe-cargo-app): `src/lib/theme.ts`, `Marca` en `src/components/ui.tsx`, íconos y splash en `assets/`.
