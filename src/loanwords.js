// Deterministic restoration of transliterated work terms to Latin script.
//
// Why this is code and not a prompt rule: giving the cleanup model a mandate to
// rewrite words that "look transliterated" was measured to make it occasionally
// rewrite a place name into a different real city (רעננה -> הרצליה). That risk
// cannot be fenced by wording, because the model must judge case-by-case what is
// a name. A lookup table cannot hallucinate: a word is either in it or it is not.
//
// Add terms freely — keys are the Hebrew transliteration, values the Latin spelling.
export const LOANWORDS = {
  "סטייג'ינג": 'staging',
  'סטייגינג': 'staging',
  'דיפלוי': 'deploy',
  'רליס': 'release',
  'ריליס': 'release',
  'מיינור': 'minor',
  'בקאנד': 'backend',
  'בקנד': 'backend',
  'בקנט': 'backend',
  'פרונטאנד': 'frontend',
  'פרונטנד': 'frontend',
  'דשבורד': 'dashboard',
  'ספרינט': 'sprint',
  'סטנדאפ': 'standup',
  'סקופ': 'scope',
  'פולואפ': 'follow-up',
  "פולו-אפ": 'follow-up',
  'באג': 'bug',
  'בג': 'bug',
  'בלוקר': 'blocker',
  'מרג': 'merge',
  "מרג'": 'merge',
  'פיצ\'ר': 'feature',
  'ריפו': 'repo',
  'פוש': 'push',
  'קומיט': 'commit',
  'דדליין': 'deadline',
  'מיטינג': 'meeting',
  'פרודקשן': 'production',
  'פרוד': 'production',
};

// Hebrew has no casing, but it does glue prefix letters (ב ל ה ו כ מ ש) onto a
// following word, and stacks up to two of them. Those must be preserved:
// "לסטייג'ינג" -> "לstaging", "מהבקנט" -> "מהbackend".
const PREFIXES = 'בלהוכמש';

// A Hebrew letter on either side means we are inside a longer word (באג vs באגרטל),
// so the match must not fire there.
const HEB = '֐-׿';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest keys first so "פולו-אפ" wins over any shorter overlapping key.
const KEYS = Object.keys(LOANWORDS).sort((a, b) => b.length - a.length);

const PATTERN = new RegExp(
  `(^|[^${HEB}])([${PREFIXES}]{0,2})(${KEYS.map(escape).join('|')})(?![${HEB}])`,
  'g'
);

/**
 * Replaces known transliterated work terms with their Latin spelling.
 * Pure, deterministic, and idempotent. Words absent from LOANWORDS are never touched.
 */
export function restoreLoanwords(text) {
  return text.replace(PATTERN, (_m, before, prefix, word) => before + prefix + LOANWORDS[word]);
}
