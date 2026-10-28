// CC-088 (F-64, MP-03 §1 "amounts in words (Arabic and English) on financial documents"). The amount is read from the
// database text digit by digit (no floating point, no rounding): the integer part in words, the fraction as many digits
// as the currency's minor units (ISO 4217). The names of the currency and its sub-unit are company settings
// (currency_words); without them the currency code is written and the fraction as digits over 100 / 1000.
// Arabic follows the accounting form "فقط ... لا غير" with the counted forms of ألف / مليون / مليار / تريليون
// (ألف، ألفان، آلاف 3-10، ألفًا 11-99) and masculine numbers; the currency name is written as the company sets it.
export type CurrencyWords = { unit_ar?: string | null; subunit_ar?: string | null; unit_en?: string | null; subunit_en?: string | null };

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
// [singular, dual, plural (3-10), accusative singular (11-99)]
const AR_SCALES: [string, string, string, string][] = [['', '', '', ''], ['ألف', 'ألفان', 'آلاف', 'ألفًا'], ['مليون', 'مليونان', 'ملايين', 'مليونًا'],
  ['مليار', 'ملياران', 'مليارات', 'مليارًا'], ['تريليون', 'تريليونان', 'تريليونات', 'تريليونًا']];

// "001234" -> [1, 234] (groups of three digits, most significant first); null when beyond trillions.
function groups(digits: string): number[] | null {
  const d = digits.replace(/^0+(?=\d)/, '');
  if (d.length > 15) return null;
  const padded = d.padStart(Math.ceil(d.length / 3) * 3, '0');
  return padded.match(/\d{3}/g)!.map(Number);
}

function enBelowThousand(n: number): string {
  const h = Math.floor(n / 100), r = n % 100, parts: string[] = [];
  if (h) parts.push(`${EN_ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? EN_ONES[r] : `${EN_TENS[Math.floor(r / 10)]}${r % 10 ? `-${EN_ONES[r % 10]}` : ''}`);
  return parts.join(' ');
}
export function englishNumber(digits: string): string | null {
  const g = groups(digits);
  if (!g) return null;
  const parts = g.map((n, i) => (n ? `${enBelowThousand(n)}${EN_SCALES[g.length - 1 - i] ? ` ${EN_SCALES[g.length - 1 - i]}` : ''}` : '')).filter(Boolean);
  return parts.length ? parts.join(' ') : EN_ONES[0];
}

function arBelowThousand(n: number, construct = false): string {
  const h = Math.floor(n / 100), r = n % 100, parts: string[] = [];
  // مائتان in construct before a counted noun with nothing after it: مائتا ألف.
  if (h) parts.push(h === 2 && construct && !r ? 'مائتا' : AR_HUNDREDS[h]);
  if (r) {
    if (r < 10) parts.push(AR_ONES[r]);
    else if (r < 20) parts.push(AR_TEENS[r - 10]);
    else parts.push(r % 10 ? `${AR_ONES[r % 10]} و${AR_TENS[Math.floor(r / 10)]}` : AR_TENS[Math.floor(r / 10)]);
  }
  return parts.join(' و');
}
function arGroup(n: number, scale: number): string {
  if (!scale) return arBelowThousand(n);
  const [one, two, plural, acc] = AR_SCALES[scale];
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${arBelowThousand(n)} ${plural}`;
  const r = n % 100;
  const form = r >= 3 && r <= 10 ? plural : r >= 11 ? acc : one;
  return `${arBelowThousand(n, true)} ${form}`;
}
export function arabicNumber(digits: string): string | null {
  const g = groups(digits);
  if (!g) return null;
  const parts = g.map((n, i) => (n ? arGroup(n, g.length - 1 - i) : '')).filter(Boolean);
  return parts.length ? parts.join(' و') : 'صفر';
}

// "1234.5" with 2 minor units -> { int: "1234", frac: "50" }; null when the text is not a plain decimal or carries more
// decimals than the currency has (nothing is rounded).
function split(value: string, minorUnits: number): { neg: boolean; int: string; frac: string } | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  let frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > minorUnits) return null;
  frac = minorUnits ? frac.padEnd(minorUnits, '0') : '';
  return { neg: m[1] === '-', int: m[2], frac };
}

export function amountInWords(lang: 'ar' | 'en', value: unknown, currency: string, minorUnits: number, names: CurrencyWords | null): string | null {
  if (value === null || value === undefined) return null;
  const p = split(String(value), minorUnits);
  if (!p) return null;
  const hasFrac = !!p.frac && /[1-9]/.test(p.frac);
  if (lang === 'ar') {
    const n = arabicNumber(p.int);
    if (n === null) return null;
    const unit = names?.unit_ar || currency;
    const frac = !hasFrac ? '' : names?.subunit_ar ? ` و${arabicNumber(p.frac)} ${names.subunit_ar}` : ` و ${p.frac}/1${'0'.repeat(minorUnits)}`;
    return `فقط ${p.neg ? 'سالب ' : ''}${n} ${unit}${frac} لا غير`;
  }
  const n = englishNumber(p.int);
  if (n === null) return null;
  const unit = names?.unit_en || currency;
  const frac = !hasFrac ? '' : names?.subunit_en ? ` and ${englishNumber(p.frac)} ${names.subunit_en}` : ` and ${p.frac}/1${'0'.repeat(minorUnits)}`;
  const text = `${p.neg ? 'minus ' : ''}${n} ${unit}${frac} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
