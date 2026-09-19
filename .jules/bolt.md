## 2026-08-31 - Deduplicate disk reads via instance-level promise memoization

**Learning:** In asynchronous Node.js file storage adapters, caching async reads via promises (`objectivesReadPromise = readJson(...)`) deduplicates concurrent initial reads and prevents race conditions or unhandled rejected promises during failed disk access.

**Action:** When memoizing file reads in Node.js, store both the resolved object map and the read promise, clearing the promise on error to allow retries and prevent stale/broken state.
