<script lang="ts">
  /** Overview (the project in the middle) or Threads (a thread in the middle) for a project. */
  let { projectId, view }: { projectId: string; view: "overview" | "threads" } = $props();
</script>

<nav class="switch" aria-label="Project view">
  <a href="/projects/{projectId}" aria-current={view === "overview" ? "page" : undefined}>Overview</a>
  <a href="/projects/{projectId}/threads" aria-current={view === "threads" ? "page" : undefined}>Threads</a>
</nav>

<style>
  .switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--sunken);
  }
  a {
    flex: 1;
    padding: 5px 10px;
    border-radius: 3px;
    color: var(--ink-2);
    font-size: 13px;
    text-align: center;
    text-decoration: none;
  }
  a:hover {
    color: var(--ink);
  }
  a[aria-current="page"] {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  }
</style>
