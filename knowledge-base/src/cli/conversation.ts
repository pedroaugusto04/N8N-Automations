import { readEnvironment } from '../adapters/environment.js';
import { readJsonInput, writeJsonOutput } from '../adapters/io.js';
import { processConversation } from '../application/whatsapp-conversation.js';

const fileArg = process.argv[2] === '--file' ? String(process.argv[3] || '') : '';

readJsonInput(fileArg)
  .then((input) => processConversation(input, readEnvironment()))
  .then((result) => writeJsonOutput(result))
  .catch((error) => {
    writeJsonOutput({
      action: 'error',
      replyText: error instanceof Error ? error.message : String(error),
      payload: null,
    });
    process.exitCode = 1;
  });
