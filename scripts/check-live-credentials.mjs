const groups = {
  models: ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY'],
  google: ['GMAIL_ACCESS_TOKEN','GOOGLE_DRIVE_ACCESS_TOKEN','GOOGLE_CALENDAR_ACCESS_TOKEN','GOOGLE_PHOTOS_ACCESS_TOKEN'],
  slack: ['SLACK_ACCESS_TOKEN'],
  whatsapp: ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID'],
  belvo: ['BELVO_SECRET_ID','BELVO_SECRET_PASSWORD','BELVO_LINK_ID'],
};

const requested = process.argv.slice(2);
const names = requested.length
  ? requested.flatMap((name) => groups[name] ?? [name])
  : Object.values(groups).flat();

let missing = 0;
for (const name of [...new Set(names)]) {
  const present = Boolean(String(process.env[name] ?? '').trim());
  process.stdout.write(`${present ? 'OK' : 'MISSING'}  ${name}\n`);
  if (!present) missing += 1;
}

if (missing) {
  process.exitCode = 1;
  process.stdout.write(`\n${missing} required variable(s) missing. No secret values were printed.\n`);
} else {
  process.stdout.write('\nAll requested credential variables are present. No secret values were printed.\n');
}
