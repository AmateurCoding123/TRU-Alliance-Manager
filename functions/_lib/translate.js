// Translation with the Workers AI binding "AI", shared by Leader Chat and Announcements.
// Each model in the list is tried in turn and its answer is checked (nothing left
// untranslated, no words in the wrong alphabet). The first answer that passes is used;
// if none pass, the one with the fewest problems is. A dedicated translation model is
// the last resort. This file exports no request handlers, so Cloudflare doesn't turn it into a URL.

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

// Writing systems other than the Latin alphabet, and which languages use them.
const SCRIPTS = {
  hangul: [/[ᄀ-ᇿㄱ-ㆎ가-힣]/g, ["ko"]],
  kana: [/[぀-ヿ]/g, ["ja"]],
  han: [/[一-鿿]/g, ["zh", "ja"]],
  cyrillic: [/[Ѐ-ӿ]/g, ["ru", "uk"]],
  greek: [/[Ͱ-Ͽ]/g, ["el"]],
  arabic: [/[؀-ۿ]/g, ["ar"]],
  devanagari: [/[ऀ-ॿ]/g, ["hi"]],
  thai: [/[฀-๿]/g, ["th"]]
};

// Words that are fine to leave as they are (game terms, alliance tags).
const KEEP_WORDS = new Set(["kvk", "tru", "r4", "r5", "castle", "battle", "rally", "utc"]);

function count(text, regex) {
  return (text.match(regex) || []).length;
}

// Counts what is wrong with a translation: sentences left in the original language,
// letters from an alphabet that belongs to neither language, or no target alphabet at all.
export function translationProblems(source, out, to) {
  let problems = 0;
  const lowerOut = out.toLowerCase().replace(/\s+/g, " ");
  // Sentences of the original (4+ ordinary words) that appear unchanged in the output.
  for (const chunk of source.split(/[\n.!?:;()]+/)) {
    const words = chunk.match(/[\p{L}][\p{L}'’-]*/gu) || [];
    // All-caps Latin words are titles or tags (SAVING CHECK, TRU), not sentences.
    const ordinary = words.filter(w => !KEEP_WORDS.has(w.toLowerCase()) && !/^[A-Z0-9'’-]+$/.test(w));
    if (ordinary.length < 4) continue;
    const phrase = chunk.trim().toLowerCase().replace(/\s+/g, " ");
    if (phrase && lowerOut.includes(phrase)) problems += 2;
  }
  for (const [regex, langs] of Object.values(SCRIPTS)) {
    const inOut = count(out, regex);
    if (langs.includes(to)) {
      if (!inOut && count(source, regex) === 0) problems += 3; // never switched alphabet
    } else if (inOut > count(source, regex)) {
      problems += 1; // stray letters from an unrelated alphabet
    }
  }
  return problems;
}

// Some models wrap their answer in reasoning tags or a "Translation:" label.
function cleanOutput(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*(translation|translated text)\s*:\s*/i, "")
    .trim();
}

// Runs the models in order with the given instructions, then the backup model.
// Returns the translated text, or null if nothing worked.
export async function translateText(ai, text, { from, to, system, models, maxLength }) {
  if (!ai || !text) return null;
  const limit = maxLength || text.length * 4 + 200;
  let best = null;
  const consider = out => {
    if (!out) return false;
    const problems = translationProblems(text, out, to);
    if (!best || problems < best.problems) best = { out: out.slice(0, limit), problems };
    return problems === 0;
  };
  for (const model of models) {
    try {
      const result = await ai.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
        max_tokens: 2048,
        temperature: 0.2
      });
      if (consider(cleanOutput(result?.response))) return best.out;
    } catch (_) { /* try the next model */ }
  }
  try {
    const result = await ai.run(BACKUP_MODEL, { text, source_lang: from, target_lang: to });
    if (consider(cleanOutput(result?.translated_text))) return best.out;
  } catch (_) { /* no translation available */ }
  return best ? best.out : null;
}
