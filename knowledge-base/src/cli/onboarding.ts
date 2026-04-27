import { readEnvironment } from '../adapters/environment.js';
import { readJsonInput, writeJsonOutput } from '../adapters/io.js';
import { runOnboarding } from '../application/onboarding.js';

const fileArg = process.argv[2] === '--file' ? String(process.argv[3] || '') : '';

readJsonInput(fileArg)
  .then((input) => runOnboarding((input as { body?: unknown }).body ?? input, readEnvironment()))
  .then((result) => writeJsonOutput(result))
  .catch((error) => {
    writeJsonOutput({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
