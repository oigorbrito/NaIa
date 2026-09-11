# Reproduce the MVP evidence

Run the procedure from the repository root in a clean checkout.

1. Confirm the runtime version:

   ```powershell
   node --version
   ```

   Use Node 22, 23, or 24.

2. Install the package:

   ```powershell
   npm install
   ```

3. Run the complete product test suite:

   ```powershell
   npm test
   ```

4. Record the command exit code and the test summary. A successful run must
   report zero failures and exit with code 0.

5. Review the focused artifacts listed in `CLAIMS.md`.

The test suite creates deterministic fixtures and removes temporary data in
`finally` blocks. It does not contact a provider or scheduler outside the
process.

## Expected current result

At the time this document was written, the suite reports 18 passing tests and
zero failures. Treat a different result as a new observation and investigate
it before changing the claim matrix.
