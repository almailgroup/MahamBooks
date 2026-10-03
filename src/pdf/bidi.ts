/**
 * Text direction helpers for documents that mix Arabic and Latin text.
 * No react-pdf here, so the model builder (main thread) can use them too.
 */

export type Direction = 'ltr' | 'rtl';

const ARABIC_LETTER = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u200f]/;
const LTR_LETTER = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u1e00-\u1eff\u200e]/;

/** Left-to-right mark: keeps numbers and Latin text in order inside Arabic text. */
export const LRM = '\u200e';
/** Right-to-left mark: the same for Arabic lines inside English text. */
export const RLM = '\u200f';

export function hasArabic(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

/** Direction of the first strong letter (like `dir="auto"`); null for numbers only. */
export function textDirection(text: string): Direction | null {
  for (const ch of text) {
    if (RTL_LETTER.test(ch)) return 'rtl';
    if (LTR_LETTER.test(ch)) return 'ltr';
  }
  return null;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Marks that keep text in its own direction inside a paragraph of the other
 * direction: one in front when it starts with a sign ("+965 …", "-50.000"),
 * one after it when it ends with punctuation ("Invoice no."). Marks are only
 * added where needed: react-pdf may break a line next to one.
 */
function protect(text: string, mark: string): string {
  if (!text) return text;
  const chars = [...text];
  const start = LETTER_OR_DIGIT.test(chars[0]) ? '' : mark;
  const end = LETTER_OR_DIGIT.test(chars[chars.length - 1]) ? '' : mark;
  return `${start}${text}${end}`;
}

/** Keeps left-to-right text (an English label, a phone number) in order inside Arabic text. */
export function ltr(text: string): string {
  return protect(text, LRM);
}

/**
 * Every line of a text reads in the direction of the whole paragraph. A line
 * in the other script (an English sentence under an Arabic one) is wrapped in
 * marks, so its words and its final full stop stay in order.
 */
export function markLines(text: string, dir: Direction): string {
  if (!text.includes('\n')) return text;
  return text
    .split('\n')
    .map((line) => {
      // Numbers and phone numbers read left to right.
      const own = textDirection(line) ?? (/\d/.test(line) ? 'ltr' : dir);
      if (own === dir) return line;
      return protect(line, own === 'ltr' ? LRM : RLM);
    })
    .join('\n');
}
