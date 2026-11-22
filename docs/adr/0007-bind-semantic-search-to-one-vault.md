# Bind semantic search to one vault

rag-ai serves one indexed collection using vault-relative paths. Enable it with a
base URL and the registered vault root. Only that vault's queries can reach the
service. Deployments without these settings keep SQLite keyword search.

Use rag-ai's ranked paths and resolve them against the app's own index. The app
retains authority over note visibility, tags and titles. Keeping excerpts local
avoids returning stale text from rag-ai's index. A folder-scoped search sends a
single path prefix and checks it again locally. Searches across multiple scoped
folders use SQLite, since rag-ai accepts one prefix per request.

Combine keyword and semantic ranks using reciprocal rank fusion. Quoted queries
keep exact keyword matching. A bounded HTTP request lets search fall back to
keyword results when rag-ai is unavailable. Configure and operate the embedding
provider and backing services separately from wiki-agents.
