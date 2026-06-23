/**
 * Claude-backed translation for CMS content. Translates the VALUES of a flat
 * map of fields from one language to another, preserving HTML / markdown /
 * placeholders / brand names. Requires ANTHROPIC_API_KEY in the environment.
 * Zero dependencies — uses the global fetch available in Node 18+.
 */
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
// Cost-effective, fast model for short web copy; override per deploy if desired.
const MODEL = process.env.MOW_TRANSLATE_MODEL || 'claude-haiku-4-5-20251001';

const LANG_NAMES = {
  en: 'English', fa: 'Persian (Farsi)', es: 'Spanish', fr: 'French', de: 'German',
  ar: 'Arabic', pt: 'Portuguese', it: 'Italian', zh: 'Chinese', ja: 'Japanese',
};

export function isConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

/**
 * @param {Record<string,any>} fields  flat map { key: text }
 * @param {string} fromLang  source language code (e.g. "en")
 * @param {string} toLang    target language code (e.g. "fa")
 * @returns {Promise<Record<string,any>>} same keys, values translated
 */
export async function translateFields(fields, fromLang, toLang) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('Translation is not configured. Set ANTHROPIC_API_KEY on the server.'); e.status = 503; throw e; }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    const e = new Error('fields must be an object of { key: text }.'); e.status = 400; throw e;
  }
  // Only translate non-empty string values; pass the rest through untouched.
  const payload = {}; const passthrough = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && v.trim()) payload[k] = v; else passthrough[k] = v;
  }
  if (!Object.keys(payload).length) return { ...passthrough };

  const from = LANG_NAMES[fromLang] || fromLang;
  const to = LANG_NAMES[toLang] || toLang;
  const system = `You are a professional website translator. Translate the VALUES of the given JSON object from ${from} to ${to}. Rules: translate every value; keep the SAME keys; preserve any HTML tags, markdown, URLs, {placeholders} and brand/product names exactly; keep copy natural and concise for the web; for Persian/Arabic produce correct right-to-left text. Return ONLY a JSON object (no code fence, no commentary) with the same keys and translated values.`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, messages: [{ role: 'user', content: JSON.stringify(payload) }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const e = new Error(`Translation provider error (${res.status}). ${t.slice(0, 200)}`); e.status = 502; throw e;
  }
  const data = await res.json();
  let text = (data.content || []).map((b) => b.text || '').join('').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let out;
  try { out = JSON.parse(text); } catch { const e = new Error('Could not parse the translation response.'); e.status = 502; throw e; }
  return { ...passthrough, ...out };
}

export default { isConfigured, translateFields };
