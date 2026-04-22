import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { hasValidSession } from '../../../lib/auth';
import { buildReminderAt, inferKindAndImportance, kbPayloadSchema, normalizeText, parseCsvList, slugify } from '../../../lib/kb';
import type { ProxyResponse } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readMaxUploadBytes(): number {
  const parsed = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 1024 * 1024;
}

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) || '').trim();
}

function parseBoolean(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function buildUnauthorizedResponse() {
  return NextResponse.json(
    {
      ok: false,
      message: 'Sessao invalida. Faca login novamente.',
    },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  if (!(await hasValidSession())) {
    return buildUnauthorizedResponse();
  }

  const webhookUrl = String(process.env.KB_WEBHOOK_URL || '').trim();
  const webhookSecret = String(process.env.KB_WEBHOOK_SECRET || '').trim();
  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json(
      {
        ok: false,
        message: 'KB_WEBHOOK_URL ou KB_WEBHOOK_SECRET nao configurado.',
      },
      { status: 500 },
    );
  }

  try {
    const formData = await request.formData();
    const rawText = normalizeText(readString(formData, 'raw_text'));
    const inferred = inferKindAndImportance(rawText);
    const payloadCandidate = {
      raw_text: rawText,
      project_slug: slugify(readString(formData, 'project_slug')) || 'inbox',
      kind: (readString(formData, 'kind') || inferred.kind) as typeof inferred.kind,
      note_type: readString(formData, 'note_type'),
      importance: readString(formData, 'importance') || inferred.importance,
      status: readString(formData, 'status'),
      follow_up_by: readString(formData, 'follow_up_by'),
      reminder_date: readString(formData, 'reminder_date'),
      reminder_time: readString(formData, 'reminder_time'),
      decision_flag: parseBoolean(readString(formData, 'decision_flag')),
      tags: parseCsvList(readString(formData, 'tags'), { slugifyItems: true }),
      related_projects: parseCsvList(readString(formData, 'related_projects'), { slugifyItems: true }),
    };

    const validation = kbPayloadSchema.safeParse(payloadCandidate);
    if (!validation.success) {
      return NextResponse.json(
        {
          ok: false,
          message: validation.error.issues[0]?.message || 'Payload invalido.',
        },
        { status: 400 },
      );
    }

    const upload = formData.get('attachment');
    let attachment: Record<string, unknown> | undefined;
    if (upload instanceof File && upload.size > 0) {
      const maxUploadBytes = readMaxUploadBytes();
      if (upload.size > maxUploadBytes) {
        return NextResponse.json(
          {
            ok: false,
            message: `O anexo excede o limite de ${maxUploadBytes} bytes.`,
          },
          { status: 400 },
        );
      }

      const bytes = Buffer.from(await upload.arrayBuffer());
      attachment = {
        file_name: upload.name || 'attachment.bin',
        mime_type: upload.type || 'application/octet-stream',
        size_bytes: bytes.byteLength,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        data_b64: bytes.toString('base64'),
      };
    }

    const normalized = validation.data;
    const upstreamPayload = {
      event_type: 'manual_note',
      event_id: `manual:web:${crypto.randomUUID()}`,
      triggered_at: new Date().toISOString(),
      project_slug: normalized.project_slug,
      source: 'kb-web',
      raw_text: normalized.raw_text,
      kind: normalized.kind,
      tags: normalized.tags,
      note_type: normalized.note_type,
      importance: normalized.importance,
      status: normalized.status,
      follow_up_by: normalized.follow_up_by,
      decision_flag: normalized.decision_flag,
      related_projects: normalized.related_projects,
      reminder_date: normalized.reminder_date,
      reminder_time: normalized.reminder_time,
      reminder_at: buildReminderAt(normalized.reminder_date, normalized.reminder_time),
      ...(attachment ? { attachment } : {}),
    };

    const upstreamResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kb-secret': webhookSecret,
      },
      body: JSON.stringify(upstreamPayload),
      cache: 'no-store',
    });

    const rawResponse = await upstreamResponse.text();
    let parsed: ProxyResponse;
    try {
      parsed = JSON.parse(rawResponse) as ProxyResponse;
    } catch {
      parsed = {
        ok: false,
        message: rawResponse || 'Webhook retornou resposta nao-JSON.',
      };
    }

    const status = !upstreamResponse.ok ? 502 : parsed.ok === false ? 400 : 200;
    return NextResponse.json(parsed, { status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Falha inesperada no proxy.',
      },
      { status: 500 },
    );
  }
}
