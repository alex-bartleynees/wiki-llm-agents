<script lang="ts">
  import { type Attachment, formatSize } from "@wiki-agents/contracts/attachments/model";
  import { attachmentHref } from "./api.ts";

  /** `imagesAsFiles`: the images went to the agent as files, not as images. */
  let { attachments, imagesAsFiles = false }: { attachments: ReadonlyArray<Attachment>; imagesAsFiles?: boolean } = $props();

  const images = $derived(attachments.filter((attachment) => attachment.kind === "image"));
  const files = $derived(attachments.filter((attachment) => attachment.kind === "file"));

  let dialog = $state<HTMLDialogElement>();
  let shown = $state<Attachment | null>(null);

  const show = (image: Attachment) => {
    shown = image;
    dialog?.showModal();
  };
</script>

<div class="attachments" role="group" aria-label="Attachments">
  {#if images.length > 0}
    <ul class="images">
      {#each images as image (image.id)}
        <li>
          <button type="button" class="thumb" aria-label="Show {image.name}" title="{image.name} · {formatSize(image.size)}" onclick={() => show(image)}>
            <img src={attachmentHref(image.id)} alt={image.name} loading="lazy" />
          </button>
        </li>
      {/each}
    </ul>
    {#if imagesAsFiles}<p class="as-files mono">Images sent as files</p>{/if}
  {/if}
  {#if files.length > 0}
    <ul class="files">
      {#each files as file (file.id)}
        <li>
          <a class="file mono" href={attachmentHref(file.id)} download={file.name} title="Download {file.name}">
            <span class="name">{file.name}</span>
            <span class="size">{formatSize(file.size)}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<dialog bind:this={dialog} aria-label={shown?.name ?? "Image"} onclose={() => (shown = null)}>
  {#if shown}
    <div class="bar">
      <span class="mono" title={shown.name}>{shown.name} · {formatSize(shown.size)}</span>
      <a class="mono" href={attachmentHref(shown.id)} target="_blank" rel="noopener">Open</a>
      <button type="button" aria-label="Close" onclick={() => dialog?.close()}>×</button>
    </div>
    <img src={attachmentHref(shown.id)} alt={shown.name} />
  {/if}
</dialog>

<style>
  .attachments {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 4px;
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .thumb {
    display: block;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    overflow: hidden;
    cursor: zoom-in;
  }
  .thumb img {
    display: block;
    width: 96px;
    height: 96px;
    object-fit: cover;
  }
  .as-files {
    margin: 0;
    font-size: 11px;
    color: var(--ink-3);
  }
  .files {
    flex-direction: column;
  }
  .file {
    display: inline-flex;
    gap: 8px;
    max-width: 100%;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font-size: 12px;
    text-decoration: none;
  }
  .file:hover {
    border-color: var(--accent);
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .size {
    flex: 0 0 auto;
    color: var(--ink-3);
  }
  dialog {
    max-width: min(96vw, 1200px);
    max-height: 94vh;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.6);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--line-soft);
    font-size: 12px;
  }
  .bar span {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-2);
  }
  .bar a {
    color: var(--accent-ink);
  }
  .bar button {
    width: 36px;
    height: 36px;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 18px;
    cursor: pointer;
  }
  dialog img {
    display: block;
    max-width: 100%;
    max-height: calc(94vh - 50px);
    margin: 0 auto;
    object-fit: contain;
  }
</style>
