<script lang="ts">
  import AgentsPane from "#lib/features/agents/AgentsPane.svelte";
</script>

<svelte:head><title>Agents · wiki-agents</title></svelte:head>

<div class="catalog">
  <AgentsPane />
</div>

<style>
  .catalog {
    max-width: 760px;
    height: 100%;
    margin: 0 auto;
  }
</style>
