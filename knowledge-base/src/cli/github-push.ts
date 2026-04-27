import { readEnvironment } from '../adapters/environment.js';
import { readJsonInput, writeJsonOutput } from '../adapters/io.js';
import { buildGithubReviewEvent } from '../application/github-review.js';
import { ingestEntry } from '../application/ingest-entry.js';
import { buildTelegramCodeReviewMessage } from '../domain/notifications.js';

const fileArg = process.argv[2] === '--file' ? String(process.argv[3] || '') : '';

async function main() {
  const environment = readEnvironment();
  const input = await readJsonInput(fileArg);
  const payload = await buildGithubReviewEvent(input, environment);
  const ingestResult = await ingestEntry(payload, environment);
  writeJsonOutput({
    ok: true,
    payload,
    ingestResult,
    telegramMessage: buildTelegramCodeReviewMessage(payload),
  });
}

main().catch((error) => {
  writeJsonOutput({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
