/**
 * What the vault MCP server tells the agent about itself (OpenCode shows it to the
 * model with the tools). Kept short: the rules files carry the vault conventions.
 */
export const SERVER_INSTRUCTIONS = [
  "Tools over the vault this thread works in, from its index: search, links, backlinks, note details, recent changes.",
  "Find notes with vault_search (it returns paths, titles and snippets, not whole notes), then use vault_read_note to read only the notes you need; vault_related finds graph neighbours. Provider file reads outside these tools are not tracked.",
  "vault_note_info lists a note's headings; vault_open_note opens a note (at a heading) in the user's app.",
  "Cite the notes you used as [[path/to/note#Heading]] (the path without .md, the heading as written); the app shows them as numbered references.",
  "project_ignored_files lists the files the user keeps out of this project's commits; call it before staging or committing.",
  "Every result has `notices`: read them, they say when results were cut short or something is unavailable.",
].join("\n");
