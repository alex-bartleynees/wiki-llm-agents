# Keep idle event streams open

Send an SSE comment frame every 25 seconds to keep idle connections from being
closed by proxies or browsers. Comment frames carry no application event.

End the stream when its application frames end or the server begins shutting
down. On reconnect, the browser establishes a new connection and subscribes
again. Thread subscriptions resume from the last sequence the client received.
See [the event stream documentation](../../README.md#threads).
