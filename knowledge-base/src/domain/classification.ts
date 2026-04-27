import type { IngestPayload } from '../contracts/ingest.js';

export function inferCanonicalType(kind: IngestPayload['classification']['kind'], decisionFlag = false): IngestPayload['classification']['canonicalType'] {
  if (decisionFlag) return 'decision';
  if (kind === 'bug') return 'incident';
  if (kind === 'summary' || kind === 'article') return 'knowledge';
  return 'event';
}

export function defaultImportance(kind: IngestPayload['classification']['kind']): IngestPayload['classification']['importance'] {
  if (kind === 'bug') return 'high';
  if (kind === 'summary' || kind === 'article' || kind === 'daily') return 'medium';
  return 'low';
}

export function defaultStatus(canonicalType: IngestPayload['classification']['canonicalType']): IngestPayload['classification']['status'] {
  if (canonicalType === 'incident' || canonicalType === 'followup' || canonicalType === 'reminder') {
    return 'open';
  }
  return 'active';
}
