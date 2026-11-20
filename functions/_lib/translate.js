// Translation with the Workers AI binding "AI", shared by Leader Chat and Announcements.
// Each model in the list is tried in turn; a dedicated translation model is the last resort.
// This file exports no request handlers, so Cloudflare doesn't turn it into a URL.

export const BACKUP_MODEL = "@cf/meta/m2m100-1.2b";

// Languages members can read announcements in: code -> [English name, own name].
// Codes are the ones the backup model understands.
export const LANGUAGES = {
  en: ["English", "English"],
  ko: ["Korean", "한국어"],
  de: ["German", "Deutsch"],
  fr: ["French", "Français"],
  pt: ["Portuguese", "Português"],
  es: ["Spanish", "Español"],
  it: ["Italian", "Italiano"],
  nl: ["Dutch", "Nederlands"],
  pl: ["Polish", "Polski"],
  tr: ["Turkish", "Türkçe"],
  ru: ["Russian", "Русский"],
  uk: ["Ukrainian", "Українська"],
  ro: ["Romanian", "Română"],
  el: ["Greek", "Ελληνικά"],
  sv: ["Swedish", "Svenska"],
  ar: ["Arabic", "العربية"],
  hi: ["Hindi", "हिन्दी"],
  ja: ["Japanese", "日本語"],
  zh: ["Chinese (Simplified)", "中文"],
  vi: ["Vietnamese", "Tiếng Việt"],
  th: ["Thai", "ไทย"],
  id: ["Indonesian", "Bahasa Indonesia"],
  ms: ["Malay", "Bahasa Melayu"],
  tl: ["Filipino", "Filipino"]
};

// Runs the chat models in order with the given instructions, then the backup model.
// Returns the translated text, or null if nothing worked.
export async function translateText(ai, text, { from, to, system, models, maxLength }) {
  if (!ai || !text) return null;
  const limit = maxLength || text.length * 4 + 200;
  for (const model of models) {
    try {
      const result = await ai.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
        max_tokens: 2048,
        temperature: 0.2
      });
      const out = String(result?.response || "").trim();
      if (out) return out.slice(0, limit);
    } catch (_) { /* try the next model */ }
  }
  try {
    const result = await ai.run(BACKUP_MODEL, { text, source_lang: from, target_lang: to });
    const out = String(result?.translated_text || "").trim();
    if (out) return out.slice(0, limit);
  } catch (_) { /* no translation available */ }
  return null;
}
