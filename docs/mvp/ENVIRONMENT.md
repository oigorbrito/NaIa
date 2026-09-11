# MVP environment

## Versioned inputs

- Git branch: `product/mvp-foundation-v1`
- Node engine: `>=22 <25`
- Test command: `npm test`
- Product test files: `test/product/*.test.mjs`

## Required environment

The controlled product tests require no credentials, network access, database,
or external service. Temporary persistence directories are created under the
operating system temporary directory and removed by the tests.

The CLI writes local state under `.naia`. Do not place credentials in that
directory. Persistence boundaries redact the sensitive key set defined in
`src/product/persistence-safety.mjs`.

## Reproducibility notes

The local scheduler uses explicit fixture ticks. Its evidence demonstrates
occurrence identity and replay handling only; it does not demonstrate the
behavior of an external clock or scheduler service.
