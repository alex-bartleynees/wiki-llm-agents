import type { Transcript } from "./transcript.js";

/**
 * Hand-written stand-ins for recorded turns, until slice 5's recorder saves real
 * ones. Covers a plain answer with tool calls, an approval, a question, a failure,
 * and a long answer for trying Stop and reloads. The approval really edits
 * `Replay note.md` in the thread's working folder once you approve it, so change
 * review and undo can be tried for free.
 */
export const TRANSCRIPTS: ReadonlyArray<Transcript> = [
  {
    name: "approval",
    keywords: ["approval", "edit", "change", "update"],
    steps: [
      { type: "text", text: "I'll look at the note first, then propose a change." },
      { type: "tool", name: "read", input: "Replay note.md", output: "a few lines" },
      {
        type: "approval",
        id: "edit-note",
        title: "Edit Replay note.md",
        detail: "Add a line to Replay note.md",
        write: { path: "Replay note.md", append: "- A line added by the replay agent.\n" },
        approve: [{ type: "text", text: "Done: I added a line to **Replay note.md**. You can undo it from this turn's changes." }],
        deny: [{ type: "text", text: "Understood, I've left the note as it was." }],
      },
    ],
    usage: { inputTokens: 18_204, outputTokens: 311, costUsd: 0.0412 },
  },
  {
    name: "question",
    keywords: ["question", "ask", "choose", "which"],
    steps: [
      { type: "text", text: "Before I start, one thing to settle." },
      {
        type: "question",
        id: "where",
        question: "Where should the new note go?",
        options: ["_Inbox/", "3-Resources/", "1-Active/Wiki-LLM-Agents-App/"],
        then: [{ type: "text", text: "Got it, I'll put it in `{answer}`." }],
      },
    ],
    usage: { inputTokens: 9_120, outputTokens: 96, costUsd: 0.0151 },
  },
  {
    name: "fail",
    keywords: ["fail", "error", "broken"],
    steps: [
      { type: "text", text: "Let me check that." },
      { type: "tool", name: "bash", input: "rg --files", output: "permission denied", status: "failed" },
      { type: "fail", reason: "The provider stopped with an error (recorded)." },
    ],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
  },
  {
    name: "long",
    keywords: ["long", "slow", "essay"],
    steps: [
      {
        type: "text",
        text:
          "Here is a long answer, so there is time to press Stop or reload the page. " +
          "The vault is organised with PARA: active projects in 1-Active, ongoing areas in 2-Areas, " +
          "reference material in 3-Resources, and finished work in 4-Archive. ",
      },
      { type: "pause", ms: 1500 },
      { type: "tool", name: "glob", input: "1-Active/**/*.md", output: "48 files" },
      {
        type: "text",
        text:
          "Each project folder starts from a README that links its plan, its decisions, and its log. " +
          "Agents follow the wiki-llm rules: read before writing, keep the index and the log current, " +
          "and link new notes from somewhere so nothing is orphaned. ".repeat(4),
      },
    ],
    usage: { inputTokens: 30_877, outputTokens: 1_204, costUsd: 0.0903 },
  },
  {
    name: "plan",
    keywords: ["plan", "steps"],
    steps: [
      {
        type: "plan",
        steps: [
          { text: "Read the project notes", status: "in_progress" },
          { text: "Draft a summary", status: "pending" },
          { text: "File the summary", status: "pending" },
        ],
      },
      { type: "tool", name: "read", input: "1-Active/Wiki-LLM-Agents-App/README.md", output: "96 lines" },
      {
        type: "plan",
        steps: [
          { text: "Read the project notes", status: "completed" },
          { text: "Draft a summary", status: "in_progress" },
          { text: "File the summary", status: "pending" },
        ],
      },
      { type: "text", text: "The project puts the vault and its agents in one app. " },
      {
        type: "question",
        id: "where",
        question: "Where should I file the summary?",
        options: ["_Inbox", "3-Resources"],
        then: [
          {
            type: "plan",
            steps: [
              { text: "Read the project notes", status: "completed" },
              { text: "Draft a summary", status: "completed" },
              { text: "File the summary", status: "completed" },
            ],
          },
          { type: "text", text: "Filed it in {answer}." },
        ],
      },
    ],
    usage: { inputTokens: 10_240, outputTokens: 142, costUsd: 0.0187 },
  },
  {
    name: "simple",
    keywords: [],
    steps: [
      { type: "tool", name: "vault_search", input: "\"wiki-llm\" agents", output: "6 notes" },
      { type: "tool", name: "read", input: "1-Active/Wiki-LLM-Agents-App/README.md", output: "96 lines" },
      {
        type: "text",
        text:
          "The **Wiki-LLM-Agents-App** puts the vault and coding agents in one place. " +
          "Notes are the main view, and every agent reaches the vault through the app's own MCP server.\n\n" +
          "- M1 (read the vault) is done\n- M2 adds agents, starting with this chat\n\n" +
          "This answer is a replay: try a message containing *edit*, *question*, *plan*, *long*, or *fail* for the other recordings.",
      },
    ],
    usage: { inputTokens: 12_455, outputTokens: 187, costUsd: 0.0263 },
  },
];

/** The first transcript with a keyword in the message, else `simple`. */
export const chooseTranscript = (text: string): Transcript => {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  const fallback = TRANSCRIPTS.find((transcript) => transcript.keywords.length === 0)!;
  return TRANSCRIPTS.find((transcript) => transcript.keywords.some((keyword) => words.has(keyword))) ?? fallback;
};
