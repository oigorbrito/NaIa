## 2026-03-30 - In-Memory Promise Queueing for File Ports Performance
**Learning:** Naively storing a pending promise with `.catch()` re-throws in a module variable causes `UnhandledPromiseRejection` in Node when writes fail. Instead, using an explicit write chain (`chain = chain.catch(() => {}).then(task)`) safely serializes async file writes without unhandled promise rejections or race conditions.
**Action:** When caching disk reads and serializing writes in-memory, use a promise chain with swallowed internal catches for task ordering, while returning individual task promises to callers.
