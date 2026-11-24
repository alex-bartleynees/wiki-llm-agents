<script lang="ts">
  import type { ListSkillsResponse } from "@wiki-agents/contracts/skills/list-skills/response";

  let { catalog, selectedPath, busy, open, query = $bindable(), filter = $bindable() }: {
    catalog: ListSkillsResponse;
    selectedPath: string | undefined;
    busy: boolean;
    open: (skillPath: string) => void;
    query: string;
    filter: "all" | "valid" | "problems";
  } = $props();

  const visible = $derived(catalog.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())));
  const visibleProblems = $derived(catalog.problems.filter((entry) => (entry.path + " " + entry.message).toLowerCase().includes(query.trim().toLowerCase())));
  const filters = [
    { id: "all", label: "All" },
    { id: "valid", label: "Valid" },
    { id: "problems", label: "Needs attention" },
  ] as const;
  const resultCount = $derived((filter === "problems" ? 0 : visible.length) + (filter === "valid" ? 0 : visibleProblems.length));
</script>

<section class="catalog" aria-label="Skills library">
  <input type="search" aria-label="Search skills" placeholder="Search skills" bind:value={query} />
  <div class="filters" role="group" aria-label="Filter skills">
    {#each filters as item}
      <button type="button" aria-pressed={filter === item.id} onclick={() => (filter = item.id)}>
        {item.label} {item.id === "all" ? visible.length + visibleProblems.length : item.id === "valid" ? visible.length : visibleProblems.length}
      </button>
    {/each}
  </div>
  <div class="results" role="region" aria-label="Skill results">
    {#if filter !== "problems"}
      {#each visible as skill (skill.skillPath)}
        <button class="skill" type="button" aria-pressed={selectedPath === skill.skillPath} disabled={busy} onclick={() => open(skill.skillPath)}>
          <strong>{skill.name}</strong>
          <span>{skill.description}</span>
          {#if skill.skillPath !== skill.name}<code title={skill.skillPath}>{skill.skillPath}</code>{/if}
        </button>
      {/each}
    {/if}
    {#if filter !== "valid"}
      {#each visibleProblems as problem}
        <div class="skill problem">
          <div><strong title={problem.path}>{problem.path.split("/").at(-1)}</strong><span class="badge">Needs attention</span></div>
          <p>{problem.message}</p>
        </div>
      {/each}
    {/if}
    {#if !resultCount}<p class="muted empty">No matching skills.</p>{/if}
  </div>
</section>
