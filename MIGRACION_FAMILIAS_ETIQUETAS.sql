-- Migración compatible para familias de etiquetas / subetiquetas
-- No elimina datos existentes.
ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS familia_codigo VARCHAR(80);
ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS etiqueta_padre_id INTEGER;
ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS tiene_subetiquetas BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_etiquetas_padre ON etiquetas(etiqueta_padre_id);
CREATE INDEX IF NOT EXISTS idx_etiquetas_familia ON etiquetas(familia_codigo);
