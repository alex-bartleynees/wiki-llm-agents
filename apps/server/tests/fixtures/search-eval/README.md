# Keyword retrieval baseline

Twenty fixed coffee-roastery notes include unrelated household/travel/recipe notes,
three superseded decisions, and their replacements. `cases.ts` keeps paraphrased
questions, explicit keyword queries, relevant paths and current facts. Questions
are not secretly rewritten by a model: FTS requires the provided terms.

`tests/integration/search-eval.integration.test.ts` runs the real HTTP app and MCP
transport without an LLM. For each case it measures recall over the union of FTS
and one-hop results, irrelevant result count against the fixed judgements, and
elapsed milliseconds. Timing is diagnostic, never a flaky acceptance threshold.
Every query must retrieve its current decision; old decisions remain searchable
history. A second test changes the supplier, explicitly indexes it, checks the old
fact disappears, rebuilds, then deletes the replacement and checks removal.

Retain these judgements unchanged for R2 hybrid comparisons. Report raw FTS and
expanded retrieval separately when comparing algorithms; graph expansion can add
noise. Search results alone do not assert which decision is authoritative: read the
current and superseded notes and their provenance. No LLM judge is involved.

`baseline.json` records the keyword and expanded results from this implementation.
Elapsed times are one local run, not performance budgets. Regenerate a report with
`WIKI_AGENTS_SEARCH_EVAL_REPORT=/tmp/search-eval.json nix develop -c npm test -w @wiki-agents/server -- search-eval`.
