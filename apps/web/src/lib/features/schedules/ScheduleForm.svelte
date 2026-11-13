<script lang="ts">
  import type { ProviderModel } from "@wiki-agents/contracts/providers/model";
  import type { MissedPolicy, Recurrence, Schedule, ScheduleKind } from "@wiki-agents/contracts/schedules/model";
  import { onMount } from "svelte";
  import { errorMessage, isAbort } from "#lib/api/client.ts";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import { listProviderModels } from "#lib/features/agents/api.ts";
  import NotePicker from "#lib/features/search/NotePicker.svelte";
  import { providers } from "#lib/features/threads/providers.svelte.ts";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { modelPlaceholder, modelSource } from "./schedule-model.ts";
  import { schedules } from "./schedules.svelte.ts";

  /** A new schedule, or `schedule` to edit. */
  let { schedule, onsaved, oncancel }: { schedule?: Schedule; onsaved: (schedule: Schedule) => void; oncancel: () => void } = $props();

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const pad = (value: number) => String(value).padStart(2, "0");
  const tomorrow = () => {
    const date = new Date(Date.now() + 86_400_000);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  // The form starts from the schedule being edited; later changes to it don't reset what you typed.
  const initial = (() => schedule)();
  const recurrence = initial?.recurrence;
  let kind = $state<ScheduleKind>(initial?.kind ?? "reminder");
  let title = $state(initial?.title ?? "");
  let text = $state(initial?.text ?? "");
  let repeat = $state<Recurrence["_tag"]>(recurrence?._tag ?? "daily");
  let date = $state(recurrence?._tag === "once" ? recurrence.date : tomorrow());
  let time = $state(recurrence?.time ?? "09:00");
  let days = $state<Array<number>>(recurrence?._tag === "weekly" ? [...recurrence.days] : [1, 2, 3, 4, 5]);
  let timezone = $state(initial?.timezone ?? schedules.defaultTimezone);
  let vaultId = $state(initial?.vaultId ?? "");
  let agentId = $state(initial?.agentId ?? "");
  let providerInstanceId = $state(initial?.providerInstanceId ?? "");
  let model = $state(initial?.model ?? "");
  let notePath = $state<string | null>(initial?.link?._tag === "note" ? initial.link.path : null);
  /** Typed in the note search but not picked yet. */
  let noteQuery = $state("");
  // A linked note belongs to its vault: changing the vault unlinks it.
  let noteVault = initial?.vaultId ?? "";
  $effect(() => {
    if (vaultId !== noteVault) {
      noteVault = vaultId;
      notePath = null;
      noteQuery = "";
    }
  });
  let missed = $state<MissedPolicy>(initial?.missed ?? "same-day");
  let saving = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    void vaults.load().then(() => {
      if (vaultId === "" && vaults.preferred !== undefined && initial === undefined) vaultId = vaults.preferred.id;
    });
    void agents.load();
    void providers.load();
  });

  // The models suggested for the Model field: those of the provider the run will use.
  const source = $derived(
    modelSource(
      providerInstanceId,
      agents.list.find((agent) => agent.id === agentId),
      providers.list,
    ),
  );
  const sourceProviderId = $derived(source.provider?.capabilities.models ? source.provider.id : null);
  let models = $state<ReadonlyArray<ProviderModel>>([]);
  let defaultModel = $state<string | null>(null);
  $effect(() => {
    const id = sourceProviderId;
    models = [];
    defaultModel = null;
    if (kind !== "prompt" || id === null) return;
    const controller = new AbortController();
    listProviderModels(id, controller.signal).then(
      (response) => ((models = response.models), (defaultModel = response.defaultModel)),
      (failure) => {
        if (!isAbort(failure)) models = [];
      },
    );
    return () => controller.abort();
  });

  const toggleDay =(day: number) => (days = days.includes(day) ? days.filter((other) => other !== day) : [...days, day].sort((a, b) => a - b));

  const currentRecurrence = (): Recurrence =>
    repeat === "once" ? { _tag: "once", date, time } : repeat === "daily" ? { _tag: "daily", time } : { _tag: "weekly", days, time };

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (repeat === "weekly" && days.length === 0) return void (error = "Choose at least one day.");
    const prompt = kind === "prompt";
    if (!prompt && vaultId !== "" && notePath === null && noteQuery.trim() !== "") {
      return void (error = "Pick a note from the list, or clear the note search.");
    }
    const fields = {
      title: title.trim(),
      text,
      recurrence: currentRecurrence(),
      timezone: timezone.trim(),
      vaultId: vaultId === "" ? null : vaultId,
      agentId: prompt && agentId !== "" ? agentId : null,
      providerInstanceId: prompt && providerInstanceId !== "" ? providerInstanceId : null,
      model: prompt && model.trim() !== "" ? model.trim() : null,
      link: !prompt && notePath !== null && vaultId !== "" ? { _tag: "note" as const, vaultId, path: notePath } : null,
      missed,
    };
    saving = true;
    try {
      onsaved(initial === undefined ? await schedules.create({ kind, ...fields }) : await schedules.update(initial.id, fields));
    } catch (failure) {
      error = errorMessage(failure, "Couldn't save the schedule");
    } finally {
      saving = false;
    }
  };
</script>

<form class="schedule-form" onsubmit={save} aria-label={initial === undefined ? "New schedule" : `Edit ${initial.title}`}>
  {#if initial === undefined}
    <fieldset class="kind">
      <legend>Kind</legend>
      <label><input type="radio" bind:group={kind} value="reminder" /> Reminder</label>
      <label><input type="radio" bind:group={kind} value="prompt" /> Scheduled prompt</label>
    </fieldset>
  {/if}

  <label>
    {kind === "prompt" ? "Prompt" : "Message"}
    <textarea bind:value={text} rows="3" required placeholder={kind === "prompt" ? "Summarise the morning news for me" : "Water the plants"}></textarea>
  </label>
  <label>
    Title
    <input bind:value={title} placeholder="Defaults to the first line" />
  </label>

  <div class="row">
    <label>
      Repeat
      <select bind:value={repeat}>
        <option value="once">Once</option>
        <option value="daily">Every day</option>
        <option value="weekly">Weekly</option>
      </select>
    </label>
    {#if repeat === "once"}
      <label>
        Date
        <input type="date" bind:value={date} required />
      </label>
    {/if}
    <label>
      Time
      <input type="time" bind:value={time} required />
    </label>
  </div>
  {#if repeat === "weekly"}
    <fieldset class="days">
      <legend>Days</legend>
      {#each DAYS as day, index (day)}
        <label><input type="checkbox" checked={days.includes(index + 1)} onchange={() => toggleDay(index + 1)} /> {day}</label>
      {/each}
    </fieldset>
  {/if}
  <label>
    Timezone
    <input bind:value={timezone} required spellcheck="false" />
  </label>

  <label>
    Vault
    <select bind:value={vaultId} required={kind === "prompt"}>
      {#if kind === "reminder"}<option value="">None</option>{/if}
      {#each vaults.list as vault (vault.id)}
        <option value={vault.id}>{vault.name}</option>
      {/each}
    </select>
  </label>

  {#if kind === "prompt"}
    <div class="row">
      <label>
        Agent
        <select bind:value={agentId}>
          <option value="">No agent (the rules alone)</option>
          {#each agents.list as agent (agent.id)}
            <option value={agent.id}>{agent.name}</option>
          {/each}
        </select>
      </label>
      <label>
        Provider
        <select bind:value={providerInstanceId}>
          <option value="">The agent's</option>
          {#each providers.list as provider (provider.id)}
            <option value={provider.id}>{provider.name}</option>
          {/each}
        </select>
      </label>
      <label>
        Model
        <input
          class="mono"
          list="schedule-models"
          bind:value={model}
          placeholder={modelPlaceholder(source, defaultModel)}
          spellcheck="false"
          autocapitalize="off"
        />
        <datalist id="schedule-models">
          {#each models as option (option.id)}<option value={option.id}>{option.name}{option.free ? " · free" : ""}</option>{/each}
        </datalist>
      </label>
    </div>
    <label>
      If the app was off at the time
      <select bind:value={missed}>
        <option value="same-day">Run it if it's still the same day</option>
        <option value="always">Run it anyway</option>
        <option value="skip">Skip it</option>
      </select>
    </label>
    <p class="hint">It runs unattended: anything the agent would ask you is denied, and its answer arrives in the inbox.</p>
  {:else if vaultId !== ""}
    <NotePicker {vaultId} bind:path={notePath} bind:query={noteQuery} label="Link a note" />
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button type="submit" class="primary" disabled={saving}>{initial === undefined ? "Create schedule" : "Save changes"}</button>
    <button type="button" onclick={oncancel}>Cancel</button>
  </div>
</form>

<style>
  .schedule-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--ink-2);
  }
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 0;
    padding: 0;
    border: 0;
    font-size: 13px;
  }
  legend {
    width: 100%;
    margin-bottom: 4px;
    color: var(--ink-2);
  }
  fieldset label {
    flex-direction: row;
    align-items: center;
    color: var(--ink);
  }
  input:not([type="radio"], [type="checkbox"]),
  select,
  textarea {
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  /* As specific as the input rule above, and after it, so the mono font wins over `font: inherit`. */
  input.mono {
    font-family: var(--font-mono);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .row > label {
    flex: 1 1 140px;
  }
  .hint {
    margin: 0;
    color: var(--ink-3);
    font-size: 12px;
  }
  .error {
    margin: 0;
    color: var(--del);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  button {
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
</style>
