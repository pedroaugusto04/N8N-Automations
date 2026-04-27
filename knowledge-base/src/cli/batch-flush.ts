import { readEnvironment } from '../adapters/environment.js';
import { writeJsonOutput } from '../adapters/io.js';
import { flushVaultBatch } from '../application/batch-flush.js';

flushVaultBatch(readEnvironment())
  .then((result) => writeJsonOutput(result))
  .catch((error) => {
    writeJsonOutput({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
