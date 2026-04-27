import type { RuntimeEnvironment } from '../adapters/environment.js';
import { buildPushGitConfigs, runGit } from '../adapters/git.js';

export async function flushVaultBatch(environment: RuntimeEnvironment) {
  const changed = await runGit(environment.vaultPath, ['status', '--porcelain'], { allowFailure: true });
  if (!String(changed.stdout || '').trim()) {
    return { ok: true, status: 'no_changes' };
  }
  await runGit(environment.vaultPath, ['add', '-A']);
  const commitMessage = `kb: batch ingest ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  const commitResult = await runGit(environment.vaultPath, ['commit', '-m', commitMessage], { allowFailure: true });
  let pushStatus = 'disabled';
  if (environment.enableGitPush) {
    const pushGitConfigs = buildPushGitConfigs(environment.vaultRemoteUrl, environment.gitPushUsername, environment.gitPushToken);
    const pushResult = await runGit(environment.vaultPath, ['push', 'origin', 'HEAD'], { allowFailure: true, gitConfigs: pushGitConfigs });
    pushStatus = pushResult.ok ? 'pushed' : `push_failed:${pushResult.stderr}`;
  }
  return {
    ok: true,
    status: 'batched',
    commitCreated: commitResult.ok,
    commitMessage,
    pushStatus,
  };
}
