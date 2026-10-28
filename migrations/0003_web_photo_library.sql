ALTER TABLE collection_consents ADD COLUMN storage TEXT NOT NULL DEFAULT 'drive';
CREATE TABLE collection_images (
  id TEXT PRIMARY KEY REFERENCES collection_items(id) ON DELETE CASCADE,
  receipt_hash TEXT NOT NULL REFERENCES collection_consents(receipt_hash) ON DELETE CASCADE,
  data TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX collection_images_expiry ON collection_images(expires);
CREATE INDEX collection_images_receipt ON collection_images(receipt_hash);
CREATE TRIGGER collection_image_deleted AFTER DELETE ON collection_images BEGIN
  UPDATE collection_items SET status='deleted' WHERE id=OLD.id;
END;
