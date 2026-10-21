// Hebrew glues prefix letters (ב ל ה ו כ מ ש) onto a following word, up to two of
// them. They are kept in Hebrew: "לסטייג'ינג" -> "לstaging", "מהבקנד" -> "מהbackend".
export const PREFIXES = 'בלהוכמש';

// A Hebrew letter on either side means we are inside a longer word (באג vs באגרטל).
export const HEB = '֐-׿';

const FOLD = { '’': "'", '‘': "'", '׳': "'", '“': '"', '”': '"', '„': '"', '״': '"' };

// iOS Smart Punctuation and Hebrew geresh/gershayim, folded to ASCII quotes. One
// character in, one character out, so offsets into the folded text are offsets
// into the original.
export function fold(text) {
  return text.replace(/[’‘׳“”„״]/g, (c) => FOLD[c]);
}

// The word, and the word without its first one and two letters when those are
// prefix letters. Never an empty stem.
export function stripPrefixes(word) {
  const out = [word];
  for (let n = 1; n <= 2; n++) {
    if (word.length > n && PREFIXES.includes(word[n - 1])) out.push(word.slice(n));
    else break;
  }
  return out;
}
