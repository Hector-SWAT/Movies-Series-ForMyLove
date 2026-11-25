-- Ejecutar UNA sola vez en bases creadas antes de este cambio:
--   npm run db:migrar
ALTER TABLE titles ADD COLUMN storage TEXT;
ALTER TABLE videos ADD COLUMN storage TEXT;
