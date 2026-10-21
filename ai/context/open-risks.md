# rag-chatbot — open risks

What is not yet proven or not yet decided. The full write-up of every risk,
including the accepted and resolved ones, is
`specs/epics/rag-chatbot/risks-and-open-questions.md`; this page lists only
what is still live, so it should be short.

| ID | Risk | State | What closes it |
|---|---|---|---|
| RG-J | The models are verified only against a stand-in: whether Llama 4 Scout calls the tools as prompted (with the `id` the provider needs), whether JSON mode accepts understandQuery's schema, and how well bge-base-en-v1.5 retrieves are unproven | OPEN | A bootstrap against a real Cloudflare account, chatting on the deployed Worker |
| RG-K | No deploy with the brokered `workers-deploy` token has uploaded a script with an `ai` binding; Cloudflare may ask for a Workers AI permission | OPEN | The first live deploy (or the permission group added to the template) |

Accepted, and worth knowing before you change them: RG-N (the e2e's Postgres
stand-in creates pgvector as superuser; a real db-migrate apply is the first
time `postgres` runs that statement), RG-O (two Supabase projects per product
— the organization needs room for both).
