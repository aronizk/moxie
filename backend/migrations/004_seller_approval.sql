ALTER TABLE users ADD COLUMN can_post BOOLEAN NOT NULL DEFAULT false;

-- Grandfather in every account that existed before this feature shipped,
-- so existing sellers are not suddenly blocked from posting new listings.
UPDATE users SET can_post = true;
