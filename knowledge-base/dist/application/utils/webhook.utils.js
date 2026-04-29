export function normalizeHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(',') : String(value || '')]));
}
export function extractWhatsappExternalId(body) {
    const data = body.data;
    const key = data?.key;
    return String(body.jid ||
        body.remoteJid ||
        body.chatId ||
        body.from ||
        key?.remoteJid ||
        data?.remoteJid ||
        data?.chatId ||
        '').trim();
}
