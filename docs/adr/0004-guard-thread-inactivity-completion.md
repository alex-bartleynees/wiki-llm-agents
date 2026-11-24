# Guard thread inactivity completion

The sweep selects bounded pages of candidates and submits them to their thread
actors. The conditional SQLite update checks the current policy, cutoff, and
durable blockers because policy and draft writes can happen outside the actor.

Starting work in a child thread reopens an automatically completed manager in
the same transaction as the child event. The child actor publishes the manager
summary after the commit. This covers both orderings. If child work commits
first, it blocks automatic completion. If automatic completion commits first,
child work reopens the manager. A manually completed manager stays Done until
its usual reopen action or an accepted message in that manager thread.

The pre-inactivity schema did not retain a reopen timestamp, so the migration
starts legacy threads' inactivity period at migration time. It preserves
existing completion timestamps.
