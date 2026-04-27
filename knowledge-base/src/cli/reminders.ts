import { readEnvironment } from '../adapters/environment.js';
import { writeJsonOutput } from '../adapters/io.js';
import { buildReminderDispatch, markRemindersAsSent } from '../application/reminders.js';

const mode = String(process.argv[2] || '').trim();
const arg = String(process.argv[3] || '').trim();
const environment = readEnvironment();

async function main() {
  if (mode === 'daily' || mode === 'exact') {
    writeJsonOutput(await buildReminderDispatch(mode, environment));
    return;
  }
  if (mode === 'mark-sent') {
    writeJsonOutput(await markRemindersAsSent(arg ? arg.split(',') : [], environment));
    return;
  }
  throw new Error('invalid_reminder_mode');
}

main().catch((error) => {
  writeJsonOutput({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
