# db-tests

The migrations' tests (the manifest and its checksums, each migration the twin of the app's drizzle-kit one, the pgvector embeddings column at Workers AI's 768 dimensions, and row-level security on every table in public after every migration, on an in-process Postgres with pgvector)

The test suite for **db**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/db`           |
| Package      | `@app/db-tests`      |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
