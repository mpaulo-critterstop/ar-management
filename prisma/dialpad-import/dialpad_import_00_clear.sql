-- Step 0: Clear existing Dialpad data
DELETE FROM dialpad_calls;
DELETE FROM dialpad_known_callers;
DELETE FROM dialpad_config WHERE key = 'last_sync_cursor';
