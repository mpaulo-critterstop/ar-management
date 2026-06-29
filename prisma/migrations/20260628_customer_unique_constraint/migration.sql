ALTER TABLE customers ADD CONSTRAINT customers_externalid_office_unique UNIQUE ("externalId", office);
