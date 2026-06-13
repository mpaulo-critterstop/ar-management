-- Step 0: Clear Dialpad call data only
-- Preserves dialpad_config (API key, Slack webhook, etc.)
DELETE FROM dialpad_calls;
DELETE FROM dialpad_known_callers;
DELETE FROM dialpad_config WHERE key = 'last_sync_cursor';
