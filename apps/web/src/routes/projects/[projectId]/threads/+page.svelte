<script lang="ts">
  import { page } from "$app/state";
  import ProjectsPage from "#lib/features/projects/ProjectsPage.svelte";
</script>

<ProjectsPage projectId={page.params["projectId"] ?? null} view="threads" />
