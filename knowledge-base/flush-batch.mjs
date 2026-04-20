#!/usr/bin/env node

import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);
const vaultPath = process.env.KB_VAULT_PATH || '/home/node/knowledge-vault';
const enableGitPush = String(process.env.KB_ENABLE_GIT_PUSH || 'false').toLowerCase() === 'true';
const vaultRemoteUrl = (process.env.KB_VAULT_REMOTE_URL || '').trim();
const gitUserName = (process.env.KB_VAULT_GIT_USER_NAME || 'knowledge-bot').trim();
const gitUserEmail = (process.env.KB_VAULT_GIT_USER_EMAIL || 'knowledge-bot@example.local').trim();
const gitPushUsername = (process.env.KB_VAULT_GIT_PUSH_USERNAME || '').trim();
const gitPushToken = (process.env.KB_VAULT_GIT_PUSH_TOKEN || '').trim();

function buildPushGitConfigs(remoteUrl) {
  if (!remoteUrl || !/^https:\/\//i.test(remoteUrl)) {
    return [];
  }
  if (!gitPushUsername || !gitPushToken) {
    return [];
  }
  const auth = Buffer.from(`${gitPushUsername}:${gitPushToken}`, 'utf8').toString('base64');
  return [`http.extraheader=AUTHORIZATION: Basic ${auth}`];
}

async function runGit(args, { allowFailure = false, gitConfigs = [] } = {}) {
  try {
    const configArgs = [
      '-c',
      `safe.directory=${vaultPath}`,
      ...gitConfigs.flatMap((entry) => ['-c', entry]),
    ];
    const result = await execFile('git', [...configArgs, '-C', vaultPath, ...args], {
      cwd: vaultPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
    };
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
      code: error.code ?? null,
    };
  }
}

async function ensureVaultRepository() {
  await runGit(['config', 'user.name', gitUserName]);
  await runGit(['config', 'user.email', gitUserEmail]);

  if (vaultRemoteUrl) {
    const remotes = await runGit(['remote'], { allowFailure: true });
    const remoteNames = new Set(String(remotes.stdout || '').split(/\r?\n/).filter(Boolean));
    if (!remoteNames.has('origin')) {
      await runGit(['remote', 'add', 'origin', vaultRemoteUrl]);
    }
  }
}

function buildBatchCommitMessage() {
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `kb: batch ingest ${iso}`;
}

async function main() {
  await ensureVaultRepository();

  const changed = await runGit(['status', '--porcelain'], { allowFailure: true });
  const hasChanges = Boolean(String(changed.stdout || '').trim());
  if (!hasChanges) {
    process.stdout.write(`${JSON.stringify({ ok: true, status: 'no_changes' })}\n`);
    return;
  }

  await runGit(['add', '-A']);
  const commitMessage = buildBatchCommitMessage();
  const commitResult = await runGit(['commit', '-m', commitMessage], { allowFailure: true });

  let pushed = false;
  let pushStatus = 'disabled';
  if (enableGitPush) {
    const remoteResult = await runGit(['remote'], { allowFailure: true });
    if (String(remoteResult.stdout || '').split(/\r?\n/).includes('origin')) {
      const pushGitConfigs = buildPushGitConfigs(vaultRemoteUrl);
      if (/^https:\/\//i.test(vaultRemoteUrl) && pushGitConfigs.length === 0) {
        pushStatus = 'missing_push_credentials';
      } else {
        const pushResult = await runGit(['push', 'origin', 'HEAD'], {
          allowFailure: true,
          gitConfigs: pushGitConfigs,
        });
        pushed = pushResult.ok;
        pushStatus = pushResult.ok ? 'pushed' : pushResult.stderr || 'push_failed';
      }
    } else {
      pushStatus = 'remote_missing';
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      status: 'batched',
      commitCreated: commitResult.ok,
      commitMessage,
      pushAttempted: enableGitPush,
      pushStatus,
      pushed,
      cwd: path.resolve(vaultPath),
    })}\n`,
  );
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      status: 'error',
      message: String(error?.message || error),
      alertMessage: `Knowledge base batch flush failed: ${String(error?.message || error)}`,
    })}\n`,
  );
  process.exitCode = 0;
});
