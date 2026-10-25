# web-tests

The app's tests (the chat route on Workers AI, the chat and embedding models, chunking and embedding, adding a resource, the database client over Hyperdrive, the page's public origin, the committed wrangler config)

The test suite for **web**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/web`          |
| Package      | `@app/web-tests`     |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
