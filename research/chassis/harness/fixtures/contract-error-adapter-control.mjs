const command = process.argv[2] ?? 'unknown';
process.stdout.write(`${JSON.stringify({
  event: 'fatal_error',
  command,
  error: 'Error: objectiveId is required',
  timestamp: new Date().toISOString()
})}\n`);
process.exitCode = 1;
