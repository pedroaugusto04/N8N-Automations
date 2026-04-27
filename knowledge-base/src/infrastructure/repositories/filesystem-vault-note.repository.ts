import fs from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';

import { readEnvironment } from '../../adapters/environment.js';
import { parseFrontmatter } from '../../domain/frontmatter.js';
import { vaultFolders } from '../../domain/notes.js';
import type { ReminderView } from '../../application/models/reminder.models.js';
import type { ReviewFindingView, ReviewView } from '../../application/models/review.models.js';
import type { VaultNoteDetail, VaultNoteSummary } from '../../application/models/vault-note.models.js';
import { VaultNoteRepository } from '../../application/ports/repositories.js';

function encodeId(relativePath: string): string {
  return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

function stripFrontmatter(content: string): string {
  return String(content || '').replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

function titleFromContent(content: string, fallback: string): string {
  const heading = stripFrontmatter(content).match(/^#\s+(.+)$/m)?.[1];
  return String(heading || fallback).trim();
}

function summaryFromContent(content: string): string {
  const body = stripFrontmatter(content);
  const summaryHeading = body.match(/##\s+(Resumo consolidado|Resumo|Impacto)\s*\n+([\s\S]*?)(\n##\s+|$)/i)?.[2];
  const candidate = summaryHeading || body.split('\n').find((line) => line.trim() && !line.trim().startsWith('#')) || '';
  return candidate.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function tagsFromFrontmatter(frontmatter: Record<string, unknown>): string[] {
  return Array.isArray(frontmatter.tags) ? frontmatter.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
}

function dateFromPathOrFrontmatter(relativePath: string, frontmatter: Record<string, unknown>): string {
  const explicit = String(frontmatter.occurred_at || frontmatter.reminder_at || '').trim();
  if (explicit) return explicit;
  const match = relativePath.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

function linksFromMarkdown(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
}

function changedFilesFromFrontmatter(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.changed_files || frontmatter.changedFiles;
  return Array.isArray(raw) ? raw.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function parseFindings(markdown: string): ReviewFindingView[] {
  return Array.from(markdown.matchAll(/-\s+\[(LOW|MEDIUM|HIGH)\]\s+(.+?)(?=\n-\s+\[(?:LOW|MEDIUM|HIGH)\]|\n##\s+|$)/gis)).map((match) => {
    const block = String(match[0] || '');
    const file = block.match(/file:\s*(.+)$/im)?.[1]?.trim() || '';
    return {
      severity: String(match[1] || 'medium').toLowerCase(),
      file,
      line: Number(block.match(/line:\s*(\d+)/im)?.[1] || 0),
      summary: String(match[2] || '').trim(),
      recommendation: block.match(/recommendation:\s*(.+)$/im)?.[1]?.trim() || '',
      status: 'open',
    };
  });
}

@Injectable()
export class FilesystemVaultNoteRepository extends VaultNoteRepository {
  private environment = readEnvironment();

  async list(): Promise<VaultNoteSummary[]> {
    const files = await this.collectMarkdownFiles(this.environment.vaultPath);
    const notes = await Promise.all(files.map((filePath) => this.toSummary(filePath)));
    return notes
      .filter((note): note is VaultNoteSummary => Boolean(note))
      .sort((left, right) => right.date.localeCompare(left.date) || left.path.localeCompare(right.path));
  }

  async getById(id: string): Promise<VaultNoteDetail | null> {
    const relativePath = decodeId(id);
    if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) return null;
    const absolutePath = path.join(this.environment.vaultPath, relativePath);
    const normalized = path.relative(this.environment.vaultPath, absolutePath);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null;

    const content = await fs.readFile(absolutePath, 'utf8').catch(() => '');
    if (!content) return null;
    const summary = await this.toSummary(absolutePath);
    if (!summary) return null;
    return {
      ...summary,
      markdown: stripFrontmatter(content),
      frontmatter: parseFrontmatter(content),
      links: linksFromMarkdown(content),
      origin: String(parseFrontmatter(content).source_channel || parseFrontmatter(content).source_system || ''),
    };
  }

  async listReviews(): Promise<ReviewView[]> {
    const details = await Promise.all((await this.list()).map((note) => this.getById(note.id)));
    return details.filter((note): note is VaultNoteDetail => Boolean(note)).filter((note) => {
      return note.tags.includes('code-review') || /^review\s/i.test(note.title) || note.markdown.includes('## Findings de review');
    }).map((note) => ({
      id: note.id,
      title: note.title,
      repo: String(note.frontmatter.repo_full_name || note.frontmatter.repoFullName || ''),
      project: note.project,
      branch: String(note.frontmatter.branch || 'main'),
      date: note.date,
      status: note.status,
      summary: note.summary,
      impact: note.markdown.match(/##\s+Impacto\s*\n+([\s\S]*?)(\n##\s+|$)/i)?.[1]?.trim() || '',
      changedFiles: changedFilesFromFrontmatter(note.frontmatter),
      generatedNotePath: note.path,
      findings: parseFindings(note.markdown),
    }));
  }

  async listReminders(): Promise<ReminderView[]> {
    const details = await Promise.all((await this.list()).map((note) => this.getById(note.id)));
    return details.filter((note): note is VaultNoteDetail => Boolean(note)).filter((note) => note.type === 'reminder').map((note) => ({
      id: String(note.frontmatter.id || note.id),
      title: note.title.replace(/^Reminder\s+/i, ''),
      project: note.project,
      status: note.status,
      reminderDate: String(note.frontmatter.reminder_date || ''),
      reminderTime: String(note.frontmatter.reminder_time || ''),
      reminderAt: String(note.frontmatter.reminder_at || ''),
      relativePath: note.path,
      sourceNotePath: Array.isArray(note.frontmatter.related) ? String(note.frontmatter.related[0] || '') : '',
    }));
  }

  private async collectMarkdownFiles(rootPath: string): Promise<string[]> {
    const results: string[] = [];
    async function walk(currentPath: string): Promise<void> {
      const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const resolved = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(resolved);
        } else if (entry.isFile() && entry.name.endsWith('.md') && !['Home.md', 'Projects.md', 'Reminders.md'].includes(entry.name)) {
          results.push(resolved);
        }
      }
    }
    await walk(rootPath);
    return results;
  }

  private async toSummary(absolutePath: string): Promise<VaultNoteSummary | null> {
    const content = await fs.readFile(absolutePath, 'utf8').catch(() => '');
    if (!content) return null;
    const relativePath = path.relative(this.environment.vaultPath, absolutePath).replace(/\\/g, '/');
    const frontmatter = parseFrontmatter(content);
    const project = String(frontmatter.project || relativePath.split('/')[1] || 'inbox');
    return {
      id: encodeId(relativePath),
      path: relativePath,
      type: String(frontmatter.type || 'note'),
      title: titleFromContent(content, path.basename(relativePath, '.md')),
      project,
      workspace: String(frontmatter.workspace || 'default'),
      tags: tagsFromFrontmatter(frontmatter),
      date: dateFromPathOrFrontmatter(relativePath, frontmatter),
      status: String(frontmatter.status || 'active'),
      summary: summaryFromContent(content),
      source: String(frontmatter.source_channel || frontmatter.source_system || ''),
    };
  }
}
