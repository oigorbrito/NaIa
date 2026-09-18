## 2025-02-18 - File Port Stat Caching for Persistent Maps and Logs
**Learning:** In multi-step persistence adapters (like `file-ports.mjs`), sequentially saving and getting states across lifecycle steps causes repeated synchronous/asynchronous file reads and JSON deserialization on identical files. Using `fs.stat` `mtimeMs` checks allows in-memory cached state re-use safely while preserving cross-process file updates.
**Action:** Always check for redundant file reads in step-driven persistence adapters and cache contents based on file stat modification timestamps (`mtimeMs`).
