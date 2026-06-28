CREATE TABLE IF NOT EXISTS "bouncie_trip_events" (
  "id"            TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "imei"          TEXT NOT NULL,
  "timestamp"     TIMESTAMP(3) NOT NULL,
  "speed"         DOUBLE PRECISION NOT NULL,
  "lat"           DOUBLE PRECISION NOT NULL,
  "lng"           DOUBLE PRECISION NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bouncie_trip_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bouncie_trip_events_imei_timestamp_idx" ON "bouncie_trip_events"("imei", "timestamp");
CREATE INDEX IF NOT EXISTS "bouncie_trip_events_transactionId_idx" ON "bouncie_trip_events"("transactionId");
