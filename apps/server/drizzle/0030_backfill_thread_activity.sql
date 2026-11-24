UPDATE threads
SET activity_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE activity_at IS NULL;
