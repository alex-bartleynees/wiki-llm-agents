# Child thread worker selection

Existing manager tools accept any configured agent and the manager design explicitly
supports Claude Code managers launching Codex workers. An omitted `workers` setting
keeps that behavior. An empty list restricts delegation to the manager's own agent.
A populated list permits self and the listed IDs. Thread autonomy still determines
whether the manager can launch a child and whether the launch needs approval.

An explicit provider instance wins. Otherwise self uses the manager's provider
instance and another agent uses its configured instance or the app default. An
explicit model wins. Otherwise the agent's default applies on its configured
provider, or on any provider with model support if the agent names no provider.
The provider supplies the remaining default. The parent's thread model does not
participate.

Discovery and explicit model validation use the inherited workspace, including
a shared worktree. The manager sees the resolved selection before approval. The
server checks eligibility and selection again before creating the child, so a
pending approval cannot grant access to a worker removed from the allowlist.
Provider model lookups run before acquiring the child mutation semaphore.
Under the semaphore the server reads current configuration and compares the
selection with the approval. The actor records the child turn under the
semaphore. The tool waits for provider dispatch after releasing the semaphore.
Each manager and its children share a semaphore for child mutations, Stop,
and inactivity completion. Other thread families can proceed while Stop waits
for a provider in that family. Manager Stop sends child interrupts through their
mailboxes while holding the family semaphore. A caller can cancel while waiting
for the semaphore. Once Stop reaches the actor mailbox, the family semaphore
stays held until the actor replies, even if the caller cancels.

Worker discovery reports each provider's readiness and reason using the same
probe as Settings, without exposing account details. A ready status with an
unknown account is valid. Child launches reject an unavailable provider before
recording a thread, including default-model launches. The readiness checks run
before approval and after it, outside the family semaphore. Normal thread
creation retains its existing behavior.

Child listings use the thread's stored selection. Provider defaults stay unset
so the provider can apply its configuration. The database records whether a
model was explicitly chosen or came from the agent. Older children with a
stored model have unknown provenance. A user-initiated model change is explicit.
