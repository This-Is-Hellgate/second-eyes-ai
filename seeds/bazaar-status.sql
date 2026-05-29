-- Bazaar discovery status captured from CDP settle EXTENSION-RESPONSES header.
ALTER TABLE access_grants ADD COLUMN bazaar_status TEXT;
ALTER TABLE access_grants ADD COLUMN bazaar_reason TEXT;
