<script lang="ts">
  import { onMount } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import { getInactivityPolicy, saveInactivityPolicy } from "./api.ts";

  let enabled = $state(false);
  let days = $state<number | undefined>(30);
  let loaded = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    void getInactivityPolicy().then(({ policy }) => {
      enabled = policy.enabled;
      days = policy.days;
      loaded = true;
    }).catch((cause: unknown) => (error = errorMessage(cause, "Could not load thread settings")));
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (days === undefined || saving) return;
    saving = true;
    saved = false;
    error = null;
    try {
      await saveInactivityPolicy({ policy: { enabled, days } });
      saved = true;
    } catch (cause) {
      error = errorMessage(cause, "Could not save thread settings");
    } finally {
      saving = false;
    }
  }
</script>

<p id="inactivity-help">
  Applies to project and vault threads on all devices. Existing threads may move to Done immediately
  after enabling this setting or shortening the interval.
</p>
<form aria-label="Thread inactivity" aria-describedby="inactivity-help" onsubmit={save} oninput={() => (saved = false)}>
  <fieldset disabled={!loaded || saving}>
    <label class="toggle">
      <input type="checkbox" bind:checked={enabled} />
      Automatically mark inactive threads as done
    </label>
    <label class="duration">
      Days of inactivity
      <input type="number" bind:value={days} min="1" max="365" step="1" required />
    </label>
    <button type="submit">Save thread settings</button>
  </fieldset>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if saved}<p role="status">Thread settings saved.</p>{/if}
</form>

<style>
  p { color: var(--ink-3); margin: 0 0 12px; }
  fieldset { border: 0; margin: 0; padding: 0; display: grid; justify-items: start; gap: 12px; }
  label { display: flex; align-items: baseline; gap: 8px; }
  input[type="number"] { width: 5rem; }
  form p { margin-top: 8px; }
</style>
