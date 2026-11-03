-- Add card last-four to the Stax payments ledger (shown in the Payment Report instead of FR Payment ID).
ALTER TABLE "stax_payments" ADD COLUMN IF NOT EXISTS "cardLast4" TEXT;
