export function slugify(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
}
export function unique(items) {
    return [...new Set(items)];
}
export function sanitizeFileStem(value, fallback = 'entry') {
    return slugify(value) || fallback;
}
export function trimText(value, fallback = '') {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
}
export function normalizeMultiline(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .trim();
}
export function stripMarkdownFences(value) {
    return String(value || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}
