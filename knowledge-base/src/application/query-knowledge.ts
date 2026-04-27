import fs from 'node:fs/promises';
import path from 'node:path';

import { answerKnowledgeQuery } from '../adapters/ai.js';
import type { RuntimeEnvironment } from '../adapters/environment.js';
import { queryInputSchema } from '../contracts/query.js';
import { parseFrontmatter } from '../domain/frontmatter.js';
import { loadProjects } from '../domain/projects.js';
import { normalizeMultiline, slugify } from '../domain/strings.js';

type NoteMatch = {
  path: string;
  title: string;
  projectSlug: string;
  score: number;
  snippet: string;
};

function queryTokens(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function stripFrontmatter(content: string): string {
  return String(content || '').replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

function extractTitle(content: string, fallback: string): string {
  const body = stripFrontmatter(content);
  const titleLine = body.split('\n').find((line) => line.trim().startsWith('#'));
  return String(titleLine || fallback).replace(/^#+\s*/, '').trim() || fallback;
}

function buildSnippet(content: string, tokens: string[]): string {
  const body = normalizeMultiline(stripFrontmatter(content));
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (tokens.some((token) => lower.includes(token))) {
      return line.slice(0, 240);
    }
  }
  return (lines[0] || '').slice(0, 240);
}

function scoreNote(params: {
  content: string;
  relativePath: string;
  tokens: string[];
  projectSlug: string;
  queryProjectSlug: string;
}): number {
  const frontmatter = parseFrontmatter(params.content);
  const body = stripFrontmatter(params.content).toLowerCase();
  const title = extractTitle(params.content, path.basename(params.relativePath, '.md')).toLowerCase();
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map((item) => String(item).toLowerCase()) : [];
  let score = 0;
  let matchedTokens = 0;
  for (const token of params.tokens) {
    let tokenScore = 0;
    if (title.includes(token)) tokenScore += 6;
    if (params.relativePath.toLowerCase().includes(token)) tokenScore += 3;
    if (tags.some((tag) => tag.includes(token))) tokenScore += 4;
    const bodyHits = body.split(token).length - 1;
    tokenScore += Math.min(bodyHits, 4) * 2;
    if (tokenScore > 0) matchedTokens += 1;
    score += tokenScore;
  }
  if (matchedTokens > 0 && params.queryProjectSlug && params.projectSlug === params.queryProjectSlug) score += 8;
  if (!params.tokens.length && params.queryProjectSlug && params.projectSlug === params.queryProjectSlug) score += 8;
  return score;
}

async function collectMarkdownFiles(rootPath: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const resolved = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(resolved);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        if (['Home.md', 'Projects.md', 'Reminders.md'].includes(entry.name)) continue;
        results.push(resolved);
      }
    }
  }
  await walk(rootPath);
  return results;
}

function fallbackAnswer(query: string, matches: NoteMatch[]): { answer: string; bullets: string[]; citedPaths: string[] } {
  if (!matches.length) {
    return {
      answer: `Nao encontrei notas relevantes para: ${query}`,
      bullets: [],
      citedPaths: [],
    };
  }
  return {
    answer: `Encontrei ${matches.length} nota(s) relevante(s) para "${query}".`,
    bullets: matches.map((match) => `${match.title}: ${match.snippet}`),
    citedPaths: matches.map((match) => match.path),
  };
}

export async function queryKnowledgeBase(rawInput: unknown, environment: RuntimeEnvironment) {
  const input = queryInputSchema.parse(rawInput);
  const tokens = queryTokens(input.query);
  const projects = await loadProjects(environment.manifestPath);
  const projectBySlug = new Map(projects.map((project) => [project.projectSlug, project]));
  const files = await collectMarkdownFiles(environment.vaultPath);
  const matches: NoteMatch[] = [];

  for (const absolutePath of files) {
    const relativePath = path.relative(environment.vaultPath, absolutePath).replace(/\\/g, '/');
    const content = await fs.readFile(absolutePath, 'utf8').catch(() => '');
    if (!content) continue;
    const frontmatter = parseFrontmatter(content);
    const projectSlug =
      slugify(String(frontmatter.project || '')) ||
      slugify(relativePath.split('/')[1] || '') ||
      '';
    const project = projectBySlug.get(projectSlug);
    if (input.projectSlug && projectSlug !== input.projectSlug) continue;
    if (input.workspaceSlug && project?.workspaceSlug !== input.workspaceSlug) continue;
    const score = scoreNote({
      content,
      relativePath,
      tokens,
      projectSlug,
      queryProjectSlug: input.projectSlug,
    });
    if (score <= 0) continue;
    matches.push({
      path: relativePath,
      title: extractTitle(content, path.basename(relativePath, '.md')),
      projectSlug,
      score,
      snippet: buildSnippet(content, tokens),
    });
  }

  matches.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const topMatches = matches.slice(0, input.limit);
  const aiAnswer =
    input.mode === 'answer'
      ? await answerKnowledgeQuery(
          {
            provider: environment.conversationAiProvider,
            baseUrl: environment.conversationAiBaseUrl,
            model: environment.conversationAiModel,
            apiKey: environment.conversationAiApiKey,
          },
          {
            query: input.query,
            matches: topMatches.map((match) => ({
              path: match.path,
              title: match.title,
              snippet: match.snippet,
            })),
          },
        )
      : null;
  const answer = aiAnswer?.answer ? aiAnswer : fallbackAnswer(input.query, topMatches);

  return {
    ok: true,
    mode: input.mode,
    query: input.query,
    matches: topMatches,
    answer,
  };
}
