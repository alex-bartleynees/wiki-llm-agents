<script lang="ts">
  import type { ConfigProblem } from "@wiki-agents/contracts/agents/model";
  import { CONNECT_FAILED_PARAM, CONNECTED_PARAM, type McpConnection } from "@wiki-agents/contracts/mcp-oauth/model";
  import type { McpServerStatus, McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";
  import { onMount, untrack } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import {
    deleteMcpServer,
    disconnect,
    finishConnect,
    getMcpServer,
    listConnections,
    listMcpServers,
    restartMcpServer,
    saveMcpServer,
    startConnect,
    testMcpServer,
  } from "./api.ts";
  import { canSignIn, connectionText, connectLabel, SIGN_IN_CHANNEL } from "./connection.ts";
  import { BLANK_FORM, describeTransport, formFromServer, idFromTitle, inputFromForm, isValidId, SCOPE_LABELS, type ServerForm } from "./server-form.ts";
  import { statusText } from "./status.ts";

  /**
   * The MCP servers in the app's config directory (`mcp/<id>.yaml`): listed, added,
   * edited and deleted here. One server is open in the editor at a time.
   */
  interface Editing {
    /** Null for a server that doesn't exist yet. */
    readonly id: string | null;
    /** The file's hash the edit started from; null for a new server, or a built-in one without a file. */
    readonly hash: string | null;
    /** A server the app adds itself (the browser): saving writes a file that replaces it. */
    readonly builtIn: boolean;
  }

  let folder = $state("");
  let servers = $state<ReadonlyArray<McpServerSummary>>([]);
  let problems = $state<ReadonlyArray<ConfigProblem>>([]);
  let loadError = $state<string | null>(null);

  let editing = $state<Editing | null>(null);
  let form = $state<ServerForm>({ ...BLANK_FORM });
  let newId = $state("");
  /** The id follows the title until you type one yourself. */
  let idTyped = $state(false);
  let saving = $state(false);
  let confirmingDelete = $state(false);
  let errors = $state<ReadonlyArray<string>>([]);
  let notice = $state<string | null>(null);

  /** Sign-ins by server id. */
  let connections = $state<ReadonlyMap<string, McpConnection>>(new Map());
  /** A sign-in started here and waiting for the identity server. */
  let signingIn = $state<{ readonly serverId: string; readonly title: string; readonly authorizationUrl: string; readonly redirectUri: string } | null>(null);
  /** The server whose Connect or Disconnect is being sent. */
  let connecting = $state<string | null>(null);
  let pasted = $state("");
  let signInError = $state<string | null>(null);
  let copied = $state(false);

  /** How the app's connections to each server are doing, by server id. */
  let statuses = $state<ReadonlyMap<string, McpServerStatus>>(new Map());
  /** The server being tested or restarted, and which. */
  let checking = $state<{ readonly serverId: string; readonly action: "test" | "restart" } | null>(null);
  /** Servers whose tool list is shown: after a test, or opened by hand. */
  let showingTools = $state<ReadonlySet<string>>(new Set());

  function setStatus(status: McpServerStatus) {
    statuses = new Map([...statuses, [status.serverId, status]]);
  }

  async function check(server: McpServerSummary, action: "test" | "restart") {
    checking = { serverId: server.id, action };
    notice = null;
    try {
      const { status } = await (action === "test" ? testMcpServer(server.id) : restartMcpServer(server.id));
      setStatus(status);
      if (action === "test" && status.problem === null) showingTools = new Set([...showingTools, server.id]);
      if (status.problem === null) notice = action === "test" ? `${server.title} answered.` : `Restarted ${server.title}.`;
    } catch (cause) {
      loadError = `${server.title}: ${errorMessage(cause, action === "test" ? "Could not test it" : "Could not restart it")}`;
    } finally {
      checking = null;
    }
  }

  function toggleTools(serverId: string) {
    const next = new Set(showingTools);
    if (!next.delete(serverId)) next.add(serverId);
    showingTools = next;
  }

  const until = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  const idShown = $derived(editing?.id ?? (idTyped ? newId : idFromTitle(form.title)));

  async function load() {
    try {
      const listed = await listMcpServers();
      folder = listed.folder;
      servers = listed.servers;
      problems = listed.problems;
      statuses = new Map(listed.statuses.map((status) => [status.serverId, status]));
      loadError = null;
    } catch (cause) {
      loadError = errorMessage(cause, "Could not load the MCP servers");
    }
    await loadConnections();
  }

  async function loadConnections() {
    try {
      connections = new Map((await listConnections()).connections.map((connection) => [connection.serverId, connection]));
    } catch (cause) {
      loadError = errorMessage(cause, "Could not load the sign-ins");
    }
  }

  async function connect(server: McpServerSummary) {
    connecting = server.id;
    signInError = null;
    notice = null;
    copied = false;
    try {
      const started = await startConnect(server.id);
      signingIn = { serverId: server.id, title: server.title, authorizationUrl: started.authorizationUrl, redirectUri: started.redirectUri };
      pasted = "";
    } catch (cause) {
      signingIn = null;
      signInError = `${server.title}: ${errorMessage(cause, "Could not start signing in")}`;
    } finally {
      connecting = null;
    }
  }

  async function finishPasted() {
    if (signingIn === null || pasted.trim() === "") return;
    const title = signingIn.title;
    signInError = null;
    try {
      await finishConnect(pasted);
      signingIn = null;
      notice = `Signed in to ${title}.`;
      await loadConnections();
    } catch (cause) {
      signInError = errorMessage(cause, "Could not finish signing in");
    }
  }

  async function signOut(server: McpServerSummary) {
    connecting = server.id;
    signInError = null;
    try {
      await disconnect(server.id);
      notice = `Signed out of ${server.title}.`;
      await loadConnections();
    } catch (cause) {
      signInError = `${server.title}: ${errorMessage(cause, "Could not sign out")}`;
    } finally {
      connecting = null;
    }
  }

  async function copyLink() {
    if (signingIn === null) return;
    try {
      await navigator.clipboard.writeText(signingIn.authorizationUrl);
      copied = true;
    } catch {
      signInError = "Couldn't copy; select the link and copy it instead.";
    }
  }

  // The identity server sends you back to this page with the outcome in the query; say
  // it, tell this app's other tabs (the one you pressed Connect in), and tidy the address.
  onMount(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SIGN_IN_CHANNEL);
    const url = new URL(window.location.href);
    const connected = url.searchParams.get(CONNECTED_PARAM);
    const failed = url.searchParams.get(CONNECT_FAILED_PARAM);
    if (connected !== null || failed !== null) {
      if (connected !== null) notice = `Signed in to ${connected}.`;
      if (failed !== null) signInError = `Signing in didn't work: ${failed}`;
      channel?.postMessage({ connected, failed });
      url.searchParams.delete(CONNECTED_PARAM);
      url.searchParams.delete(CONNECT_FAILED_PARAM);
      history.replaceState(history.state, "", url);
    }
    if (channel !== null) {
      channel.onmessage = (event: MessageEvent<{ connected: string | null; failed: string | null }>) => {
        const waiting = signingIn;
        if (event.data.connected !== null) {
          notice = `Signed in to ${waiting?.serverId === event.data.connected ? waiting.title : event.data.connected}.`;
          if (waiting?.serverId === event.data.connected) signingIn = null;
        }
        if (event.data.failed !== null) signInError = `Signing in didn't work: ${event.data.failed}`;
        void loadConnections();
      };
    }
    return () => channel?.close();
  });

  $effect(() => {
    untrack(() => void load());
  });

  function open(next: Editing, values: ServerForm) {
    editing = next;
    form = values;
    newId = "";
    idTyped = false;
    confirmingDelete = false;
    errors = [];
    notice = null;
  }

  function close() {
    editing = null;
    errors = [];
    confirmingDelete = false;
  }

  async function edit(server: McpServerSummary) {
    notice = null;
    try {
      const current = await getMcpServer(server.id);
      open({ id: server.id, hash: current.hash, builtIn: current.server.builtIn }, formFromServer(current.server));
    } catch (cause) {
      loadError = errorMessage(cause, `Could not open ${server.title}`);
      await load();
    }
  }

  async function save() {
    if (editing === null) return;
    const id = idShown;
    if (!isValidId(id)) {
      errors = ["Id: lowercase letters, digits and hyphens only, starting with a letter or digit."];
      return;
    }
    const built = inputFromForm(form);
    if ("problems" in built) {
      errors = built.problems;
      return;
    }
    saving = true;
    errors = [];
    try {
      const saved = await saveMcpServer(id, { server: built.input, baseHash: editing.hash });
      close();
      notice = `Saved ${saved.server.title}.`;
      await load();
    } catch (cause) {
      errors = errorMessage(cause, "Could not save").split("\n");
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (editing === null || editing.id === null || editing.hash === null) return;
    saving = true;
    errors = [];
    try {
      const { trashPath } = await deleteMcpServer(editing.id, editing.hash);
      close();
      notice = `Moved to ${trashPath}.`;
      await load();
    } catch (cause) {
      errors = errorMessage(cause, "Could not delete").split("\n");
      confirmingDelete = false;
    } finally {
      saving = false;
    }
  }
</script>

<div class="servers">
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}

  {#if servers.length > 0}
    <ul class="list" aria-label="MCP servers">
      {#each servers as server (server.id)}
        {@const status = statuses.get(server.id)}
        <li aria-label={server.title}>
          <div class="about">
            <span class="title">{server.title}</span>
            <span class="meta">
              <code>{server.id}</code> · {server.transport.type} · {server.scope}
              {#if server.builtIn}· <span class="built-in">built in</span>{/if}
            </span>
            <span class="availability">{server.default ? "Available to every thread" : "Available only to agents and projects that list this server"}</span>
            <span class="where">{describeTransport(server)}</span>
            {#if server.excludeTools.length > 0}<span class="where">Left out: {server.excludeTools.join(", ")}</span>{/if}
            {#if canSignIn(server)}
              {@const connection = connections.get(server.id)}
              {#if connection}
                <span class={["sign-in", connection.state]}>
                  {connectionText(connection)}{connection.state === "connected" && !connection.renews && connection.expiresAt !== null
                    ? ` until ${until(connection.expiresAt)}`
                    : ""}
                </span>
                {#if connection.problem}<span class="problem">{connection.problem}</span>{/if}
              {/if}
            {/if}
            {#if status}
              <span class={["status", status.state]}>{statusText(status)}</span>
              {#if status.problem}<span class="problem">{status.problem}</span>{/if}
              {#if status.tools !== null && status.tools.length > 0}
                <button type="button" class="link" onclick={() => toggleTools(server.id)} aria-expanded={showingTools.has(server.id)}>
                  {showingTools.has(server.id) ? "Hide tools" : "Show tools"}
                </button>
                {#if showingTools.has(server.id)}
                  <ul class="tools" aria-label={`Tools of ${server.title}`}>
                    {#each status.tools as tool (tool.name)}
                      <li>
                        <code>{server.id}__{tool.name}</code>{tool.readOnly ? " · read-only" : ""}
                        {#if tool.description}<span class="description">{tool.description}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            {/if}
          </div>
          <div class="buttons">
            <button type="button" onclick={() => void check(server, "test")} disabled={checking !== null} aria-label={`Test ${server.title}`}>
              {checking?.serverId === server.id && checking.action === "test" ? "Testing…" : "Test"}
            </button>
            {#if status && (status.connections > 0 || status.state === "failed")}
              <button type="button" onclick={() => void check(server, "restart")} disabled={checking !== null} aria-label={`Restart ${server.title}`}>
                {checking?.serverId === server.id && checking.action === "restart" ? "Restarting…" : "Restart"}
              </button>
            {/if}
            {#if canSignIn(server)}
              {@const connection = connections.get(server.id)}
              <button type="button" onclick={() => void connect(server)} disabled={connecting !== null} aria-label={`${connectLabel(connection)} ${server.title}`}>
                {connecting === server.id ? "…" : connectLabel(connection)}
              </button>
              {#if connection && connection.state !== "disconnected"}
                <button type="button" onclick={() => void signOut(server)} disabled={connecting !== null} aria-label={`Sign out of ${server.title}`}>Sign out</button>
              {/if}
            {/if}
            <button type="button" onclick={() => void edit(server)} aria-label={`Edit ${server.title}`}>Edit</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if loadError === null}
    <p class="hint">No servers yet.</p>
  {/if}

  {#if problems.length > 0}
    <ul class="problems" aria-label="MCP server files that can't be used">
      {#each problems as problem (problem.path)}
        <li><code>{problem.path}</code><span>{problem.message}</span></li>
      {/each}
    </ul>
  {/if}

  {#if signingIn}
    <section class="signing-in" aria-label={`Sign in to ${signingIn.title}`}>
      <p>
        <a href={signingIn.authorizationUrl} target="_blank" rel="noopener noreferrer" class="open">Open the sign-in page</a>
        <button type="button" onclick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</button>
        <button type="button" onclick={() => (signingIn = null)}>Cancel</button>
      </p>
      <p class="hint">
        Sign in there, on this device or another, within ten minutes. It sends you back to <code>{signingIn.redirectUri}</code>, which
        the identity server must accept.
      </p>
      <form
        aria-label="Paste the address you were sent to"
        onsubmit={(event) => {
          event.preventDefault();
          void finishPasted();
        }}
      >
        <label>
          <span class="label">If that address didn't load, paste it here</span>
          <input bind:value={pasted} aria-label="Address after signing in" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" />
        </label>
        <button type="submit" disabled={pasted.trim() === ""}>Finish signing in</button>
      </form>
    </section>
  {/if}
  {#if signInError}<p class="error" role="alert">{signInError}</p>{/if}

  {#if notice}<p class="hint" role="status">{notice}</p>{/if}

  {#if editing === null}
    <div class="actions">
      <button type="button" class="primary" onclick={() => open({ id: null, hash: null, builtIn: false }, { ...BLANK_FORM })}>Add server</button>
    </div>
  {:else}
    <form
      class="editor"
      aria-label={editing.id === null ? "New MCP server" : `Edit ${editing.id}`}
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        <span class="label">Name</span>
        <input bind:value={form.title} aria-label="Server name" placeholder="GitHub" autocomplete="off" />
      </label>
      <label>
        <span class="label">Id{editing.id === null ? "" : " (the file name; fixed once created)"}</span>
        {#if editing.id === null}
          <input
            value={idShown}
            oninput={(event) => {
              newId = event.currentTarget.value;
              idTyped = true;
            }}
            aria-label="Server id"
            placeholder="github"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="hint">Tools are named <code>{idShown === "" ? "id" : idShown}__tool</code>; the file is <code>{folder}/{idShown === "" ? "id" : idShown}.yaml</code>.</span>
        {:else}
          <input value={editing.id} aria-label="Server id" disabled />
        {/if}
      </label>

      <label>
        <span class="label">How the app reaches it</span>
        <select bind:value={form.type} aria-label="Transport">
          <option value="http">A URL (Streamable HTTP)</option>
          <option value="stdio">A command the app runs (stdio)</option>
        </select>
      </label>

      {#if form.type === "http"}
        <label>
          <span class="label">URL</span>
          <input bind:value={form.url} aria-label="URL" placeholder="https://api.githubcopilot.com/mcp/" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span class="label">Headers, one per line</span>
          <textarea bind:value={form.headers} aria-label="Headers" rows="3" placeholder={"Authorization: Bearer ${secret:github}"} autocapitalize="off" spellcheck="false"></textarea>
        </label>
        <label>
          <span class="label">Sign-in client id</span>
          <input bind:value={form.clientId} aria-label="Sign-in client id" placeholder="Registered by the app when left empty" autocapitalize="off" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span class="label">Sign-in scopes, separated by spaces</span>
          <input bind:value={form.scopes} aria-label="Sign-in scopes" placeholder="Those the server asks for" autocapitalize="off" autocomplete="off" spellcheck="false" />
          <span class="hint">For a server that asks you to sign in (OAuth): leave out the Authorization header, save, then press Connect.</span>
        </label>
      {:else}
        <label>
          <span class="label">Command</span>
          <input bind:value={form.command} aria-label="Command" placeholder="github-mcp-server" autocapitalize="off" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span class="label">Arguments, one per line</span>
          <textarea bind:value={form.args} aria-label="Arguments" rows="3" placeholder={"stdio\n--read-only"} autocapitalize="off" spellcheck="false"></textarea>
        </label>
        <label>
          <span class="label">Environment, one per line</span>
          <textarea bind:value={form.env} aria-label="Environment" rows="3" placeholder={"GITHUB_PERSONAL_ACCESS_TOKEN=${secret:github}"} autocapitalize="off" spellcheck="false"></textarea>
        </label>
        <label>
          <span class="label">Working directory</span>
          <input bind:value={form.cwd} aria-label="Working directory" placeholder="The scope's own folder" autocapitalize="off" autocomplete="off" spellcheck="false" />
        </label>
      {/if}
      <p class="hint">
        Never type a token here. Write a reference the app fills in when it connects: <code>{"${secret:name}"}</code>,
        <code>{"${env:NAME}"}</code> or <code>{"${file:/path}"}</code>.
      </p>

      <fieldset class="availability-settings">
        <legend>Tool availability</legend>
        <label class="check">
          <input type="checkbox" bind:checked={form.everyThread} />
          <span>Give its tools to every thread, whatever the agent</span>
        </label>
        <p class="hint">
          {#if form.everyThread}
            Every thread can use this server's tools from its next message, including threads without a named agent.
          {:else}
            Only threads of named agents that list this server's ID in their MCP servers field, and threads in projects that tick it
            under the project's MCP servers, receive its tools.
          {/if}
        </p>
      </fieldset>

      <label>
        <span class="label">Connection sharing</span>
        <select bind:value={form.scope} aria-label="Scope" aria-describedby="mcp-sharing-help">
          {#each Object.entries(SCOPE_LABELS) as [scope, label] (scope)}
            <option value={scope}>{label}</option>
          {/each}
        </select>
      </label>
      <p class="hint" id="mcp-sharing-help">Controls how connections are reused. Tool availability above determines which threads can use them.</p>
      <label>
        <span class="label">Access override</span>
        <select bind:value={form.access} aria-label="Access" aria-describedby="mcp-policy-help">
          <option value="">What the agent's autonomy says</option>
          <option value="allow">Nothing: always allowed</option>
          <option value="ask">Your approval each time</option>
          <option value="deny">Never allowed</option>
        </select>
      </label>
      <p class="hint" id="mcp-policy-help">Without an override, tools the server marks read-only follow the agent's <em>Read files</em> autonomy and its other tools follow <em>Use other MCP servers' tools</em>. An override replaces the agent's autonomy for all of this server's tools, for every agent, from the next message.</p>
      <label>
        <span class="label">Tools to leave out</span>
        <textarea bind:value={form.excludeTools} rows="3" aria-label="Tools to leave out" aria-describedby="mcp-exclude-help" placeholder="browser_run_code_unsafe" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
      </label>
      <p class="hint" id="mcp-exclude-help">The server's own tool names, one per line. No agent gets them and the app never calls them.</p>

      {#if editing.builtIn}
        <p class="hint" role="note">
          The app adds this server itself. Saving writes <code>{folder}/{editing.id}.yaml</code>, which then replaces it, on every machine that shares this config folder; its
          command and paths are this machine's.
        </p>
      {/if}

      {#if errors.length > 0}
        <ul class="error" role="alert">
          {#each errors as line, index (index)}<li>{line}</li>{/each}
        </ul>
      {/if}

      <div class="actions">
        <button type="submit" class="primary" disabled={saving}>{saving ? "Saving…" : editing.id === null ? "Add" : "Save"}</button>
        <button type="button" onclick={close} disabled={saving}>Cancel</button>
        {#if editing.id !== null && editing.hash !== null}
          {#if confirmingDelete}
            <button type="button" class="danger" onclick={() => void remove()} disabled={saving}>Move {editing.id} to the trash</button>
          {:else}
            <button type="button" class="danger" onclick={() => (confirmingDelete = true)} disabled={saving}>Delete</button>
          {/if}
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  .servers {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
  }
  .list,
  .problems {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list > li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .about {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .availability {
    font-size: 12px;
    color: var(--ink-2);
  }
  .availability-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .availability-settings legend {
    color: var(--ink);
    font-weight: 600;
  }
  .meta,
  .where,
  .sign-in,
  .problem {
    color: var(--ink-3);
    font-size: 12px;
  }
  .sign-in.connected,
  .status.connected {
    color: var(--accent);
  }
  .status {
    color: var(--ink-3);
    font-size: 12px;
  }
  .status.failed {
    color: var(--del);
  }
  .link {
    align-self: flex-start;
    height: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
  }
  .tools li {
    display: flex;
    flex-direction: column;
    overflow-wrap: anywhere;
  }
  .description {
    color: var(--ink-3);
  }
  .sign-in.expired,
  .sign-in.changed,
  .sign-in.unreadable,
  .problem {
    color: var(--del);
  }
  .problem {
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .signing-in {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
  .signing-in p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin: 0;
  }
  .signing-in p.hint {
    display: block;
  }
  .signing-in form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
  }
  .signing-in form label {
    flex: 1 1 240px;
  }
  .open {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    text-decoration: none;
  }
  .where {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .problems li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border: 1px solid var(--del);
    border-radius: var(--radius);
  }
  .problems code {
    overflow-wrap: anywhere;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .label {
    font-size: 12px;
    color: var(--ink-3);
  }
  select,
  input:not([type="checkbox"]),
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  select,
  input:not([type="checkbox"]) {
    height: 36px;
  }
  textarea {
    padding: 8px;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    resize: vertical;
  }
  input:disabled {
    color: var(--ink-3);
  }
  .hint {
    margin: 0;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  button {
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary {
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .danger {
    margin-left: auto;
    border-color: var(--del);
    color: var(--del);
  }
  .error {
    margin: 0;
    padding: 0;
    color: var(--del);
    list-style: none;
  }
  /* Phone: 16px so focusing doesn't zoom. */
  @media (max-width: 899px) {
    .list > li {
      flex-wrap: wrap;
    }
    .buttons {
      justify-content: flex-start;
    }
    .open {
      height: 40px;
    }
    select,
    input:not([type="checkbox"]) {
      height: 40px;
      font-size: 16px;
    }
    textarea {
      font-size: 16px;
    }
    button {
      height: 40px;
    }
  }
</style>
