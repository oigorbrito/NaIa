export function createProductShell(naia) {
  if (!naia) throw new Error('shell requires a NaIA service');

  return {
    async execute(command, args = []) {
      switch (command) {
        case 'pursue': {
          const title = args.join(' ').trim();
          if (!title) throw new Error('Usage: pursue <objective>');
          return naia.pursue({ title });
        }
        case 'resume':
          if (!args[0]) throw new Error('Usage: resume <objectiveId>');
          return naia.resume(args[0]);
        case 'approve':
          if (!args[0] || !args[1]) throw new Error('Usage: approve <objectiveId> <tool>');
          return naia.approve(args[0], args[1]);
        case 'show':
          if (!args[0]) throw new Error('Usage: show <objectiveId>');
          return naia.get(args[0]);
        case 'history':
          return naia.history();
        case 'tools':
          return naia.tools();
        default:
          throw new Error(`Unknown command: ${command}`);
      }
    },
  };
}
