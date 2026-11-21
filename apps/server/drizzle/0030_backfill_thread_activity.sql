UPDATE threads
SET activity_at = MAX(
  created_at,
  CAST(unixepoch('subsec') * 1000 AS INTEGER),
  COALESCE((SELECT MAX(e.at) FROM thread_events e
    WHERE e.thread_id = threads.id
      AND e.type IN ('user.message', 'subagent.updated', 'subagent.reported')), 0),
  COALESCE((SELECT MAX(t.ended_at) FROM turns t WHERE t.thread_id = threads.id), 0),
  COALESCE((SELECT MAX(r.resolved_at) FROM runtime_requests r WHERE r.thread_id = threads.id), 0)
)
WHERE activity_at IS NULL;
