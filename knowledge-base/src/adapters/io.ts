import fs from 'node:fs/promises';

export async function readJsonInput(fileArg = ''): Promise<unknown> {
  if (fileArg) {
    const raw = await fs.readFile(fileArg, 'utf8');
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function writeJsonOutput(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
