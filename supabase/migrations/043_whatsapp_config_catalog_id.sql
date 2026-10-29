-- ============================================================
-- Add catalog_id to whatsapp_config
-- ============================================================
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS catalog_id TEXT;
