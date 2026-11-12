<script lang="ts">
  import type { NotificationPreferences, PushRoute, PushRoutes } from "@wiki-agents/contracts/notifications/model";
  import InboxViewSwitch from "#lib/features/inbox/InboxViewSwitch.svelte";
  import { notifications } from "./notifications.svelte.ts";

  $effect(() => {
    void notifications.load();
  });

  const GROUPS: ReadonlyArray<{ key: keyof PushRoutes; label: string; hint: string }> = [
    { key: "reminders", label: "Reminders", hint: "and scheduled prompts that were missed" },
    { key: "requests", label: "Agents waiting for you", hint: "approvals and questions" },
    { key: "results", label: "Scheduled prompts", hint: "answers and failures" },
    { key: "turns", label: "Turns finished", hint: "a thread's turn finished or failed" },
  ];

  const ROUTES: ReadonlyArray<{ value: PushRoute; label: string }> = [
    { value: "immediate", label: "Notify at once" },
    { value: "digest", label: "In the morning digest" },
    { value: "off", label: "Inbox only" },
  ];

  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const save = (change: Partial<NotificationPreferences>) => {
    if (notifications.preferences !== null) void notifications.savePreferences({ ...notifications.preferences, ...change });
  };

  const setRoute = (key: keyof PushRoutes, route: PushRoute) => {
    if (notifications.preferences !== null) save({ routes: { ...notifications.preferences.routes, [key]: route } });
  };
</script>

<div class="page">
  <header>
    <InboxViewSwitch view="notifications" />
  </header>

  {#if notifications.error}<p class="error" role="alert">{notifications.error}</p>{/if}

  <section aria-labelledby="this-device">
    <h2 id="this-device">This device</h2>
    {#if notifications.support === "insecure"}
      <p class="muted">
        Browsers allow notifications only over HTTPS (or on this computer at localhost). Open the app at its HTTPS address to turn
        them on here.
      </p>
    {:else if notifications.support === "install-first"}
      <p class="muted">
        On iPhone and iPad, add the app to your Home Screen first (Share, then Add to Home Screen), and turn notifications on from
        there.
      </p>
    {:else if notifications.support === "unsupported"}
      <p class="muted">This browser can't show notifications from web apps.</p>
    {:else if notifications.thisDevice}
      <p>Notifications are on for <strong>{notifications.thisDevice.name}</strong>.</p>
      <div class="actions">
        <button type="button" onclick={() => void notifications.test(notifications.thisDeviceId!)}>Send test</button>
        <button type="button" disabled={notifications.busy} onclick={() => void notifications.disable()}>Turn off here</button>
      </div>
    {:else if notifications.permission === "denied"}
      <p class="muted">Notifications are blocked for this site. Allow them in the browser's site settings, then reload.</p>
    {:else}
      <p class="muted">Get reminders, answers and agents waiting for you here, even with the app closed.</p>
      <div class="actions">
        <button type="button" class="primary" disabled={notifications.busy || notifications.status !== "loaded"} onclick={() => void notifications.enable()}>
          {notifications.busy ? "Turning on…" : "Enable notifications"}
        </button>
      </div>
    {/if}
  </section>

  <section aria-labelledby="devices">
    <h2 id="devices">Devices</h2>
    {#if notifications.status === "loading"}
      <p class="muted">Loading…</p>
    {:else if notifications.devices.length === 0}
      <p class="muted">No devices get notifications yet.</p>
    {:else}
      <ul class="devices">
        {#each notifications.devices as device (device.id)}
          <li aria-label={device.name}>
            <div class="device-head">
              <strong>{device.name}</strong>
              {#if device.id === notifications.thisDeviceId}<span class="tag">this device</span>{/if}
              {#if device.disabled}<span class="tag bad">disabled</span>{/if}
            </div>
            <p class="muted mono">
              {device.service} · added {when(device.createdAt)}{#if device.lastSentAt !== null} · last sent {when(device.lastSentAt)}{/if}
            </p>
            {#if device.lastError}
              <p class="error">
                {device.disabled ? `Stopped after ${device.failures} failures in a row` : `Failed ${device.failures}× in a row`}: {device.lastError}
              </p>
            {/if}
            {#if notifications.tests[device.id]}<p class="muted" role="status">{notifications.tests[device.id]}</p>{/if}
            <div class="actions">
              <button type="button" onclick={() => void notifications.test(device.id)}>Send test</button>
              <button type="button" disabled={notifications.busy} onclick={() => void notifications.remove(device.id)}>Remove</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if notifications.preferences}
    {@const preferences = notifications.preferences}
    <section aria-labelledby="preferences">
      <h2 id="preferences">What notifies you</h2>
      <label class="check">
        <input type="checkbox" checked={preferences.muted} onchange={(event) => save({ muted: event.currentTarget.checked })} />
        <span>Mute all notifications <span class="muted">(the inbox keeps everything)</span></span>
      </label>
      <label class="check">
        <input type="checkbox" checked={preferences.privatePreviews} onchange={(event) => save({ privatePreviews: event.currentTarget.checked })} />
        <span>Private previews <span class="muted">(say only what kind of item arrived, never its text)</span></span>
      </label>
      <div class="routes">
        {#each GROUPS as group (group.key)}
          <label class="route">
            <span>{group.label} <span class="muted">({group.hint})</span></span>
            <select value={preferences.routes[group.key]} onchange={(event) => setRoute(group.key, event.currentTarget.value as PushRoute)}>
              {#each ROUTES as route (route.value)}
                <option value={route.value}>{route.label}</option>
              {/each}
            </select>
          </label>
        {/each}
        <label class="route">
          <span>Morning digest at</span>
          <input
            type="time"
            value={preferences.digestTime}
            onchange={(event) => {
              if (/^\d\d:\d\d$/.test(event.currentTarget.value)) save({ digestTime: event.currentTarget.value });
            }}
          />
        </label>
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  header {
    display: flex;
  }
  section {
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
  }
  p {
    margin: 4px 0;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
  .mono {
    font-size: 12px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  button,
  select,
  input[type="time"] {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  button {
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .devices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .devices li + li {
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .device-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 14px;
  }
  .tag {
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--ink-2);
    font-size: 11px;
  }
  .tag.bad {
    color: var(--del);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0;
    font-size: 14px;
  }
  .routes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  .route {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
    font-size: 14px;
  }
</style>
