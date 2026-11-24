<script lang="ts">
  import type { ListSkillsResponse } from "@wiki-agents/contracts/skills/list-skills/response";
  import Input from "#lib/ui/primitives/Input.svelte";
  import Button from "#lib/ui/primitives/Button.svelte";

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
  <Input size="large" class="search" type="search" aria-label="Search skills" placeholder="Search skills" bind:value={query} />
  <div class="filters" role="group" aria-label="Filter skills">
    {#each filters as item}
      <Button size="small" pill aria-pressed={filter === item.id} onclick={() => (filter = item.id)}>
        {item.label} {item.id === "all" ? visible.length + visibleProblems.length : item.id === "valid" ? visible.length : visibleProblems.length}
      </Button>
    {/each}
  </div>
  <div class="results" role="region" aria-label="Skill results">
    {#if filter !== "problems"}
      {#each visible as skill (skill.skillPath)}
        <button class="skill" type="button" aria-pressed={selectedPath === skill.skillPath} disabled={busy} onclick={() => open(skill.skillPath)}>
          <strong>{skill.name}</strong>
          <span>{skill.description}</span>
          {#if skill.skillPath !== skill.name}<code class="mono" title={skill.skillPath}>{skill.skillPath}</code>{/if}
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

<style>
  p {
    margin: 0;
  }

  .muted {
    color: var(--ink-3);
  }

  .catalog {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 0;
    min-height: 0;
    max-height: 100%;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);

    > :global(.search) {
      flex: none;
    }
  }

  .filters {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 6px;
    margin-block: 11px 12px;
  }

  button.skill:enabled:hover {
    background: var(--sunken);
  }

  button.skill:enabled {
    cursor: pointer;
  }

  button.skill:disabled {
    opacity: 0.6;
  }

  button.skill[aria-pressed="true"],
  button.skill[aria-pressed="true"]:hover {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--ink);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 0;
    padding: 2px;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    scrollbar-gutter: stable;
  }

  .skill {
    display: grid;
    flex: none;
    gap: 2px;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    text-align: left;
    overflow-wrap: anywhere;

    strong {
      font-family: var(--font-mono);
    }

    > span {
      display: -webkit-box;
      overflow: hidden;
      color: var(--ink-3);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }

    > code {
      overflow: hidden;
      color: var(--ink-3);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .problem {
    color: var(--del);

    > div {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
    }

    strong {
      color: var(--ink);
    }
  }

  .badge {
    padding: 2px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--del) 12%, var(--surface));
    color: var(--del);
    font-size: 12px;
    font-weight: 600;
  }

  .empty {
    padding: 16px;
  }

  @media (max-width: 699px) {
    .catalog {
      padding: 0;
      border: 0;
      background: transparent;

      > :global(.search) {
        background: var(--surface);
      }
    }

    .results {
      gap: 6px;
    }

    .skill {
      padding: 9px 12px;
      border-color: var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
    }

    .problem {
      border-color: color-mix(in srgb, var(--del) 35%, var(--line));
    }
  }
</style>
