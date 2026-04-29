import { CanonicalType, Importance, KnowledgeKind, KnowledgeStatus } from '../contracts/enums.js';
export function inferCanonicalType(kind, decisionFlag = false) {
    if (decisionFlag)
        return CanonicalType.Decision;
    if (kind === KnowledgeKind.Bug)
        return CanonicalType.Incident;
    if (kind === KnowledgeKind.Summary || kind === KnowledgeKind.Article)
        return CanonicalType.Knowledge;
    return CanonicalType.Event;
}
export function defaultImportance(kind) {
    if (kind === KnowledgeKind.Bug)
        return Importance.High;
    if (kind === KnowledgeKind.Summary || kind === KnowledgeKind.Article || kind === KnowledgeKind.Daily)
        return Importance.Medium;
    return Importance.Low;
}
export function defaultStatus(canonicalType) {
    if (canonicalType === CanonicalType.Incident || canonicalType === CanonicalType.Followup || canonicalType === CanonicalType.Reminder) {
        return KnowledgeStatus.Open;
    }
    return KnowledgeStatus.Active;
}
