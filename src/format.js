// Number and date formatting that reproduces the .NET Framework 4.5 output the
// Windows app writes. .NET Framework first reduces a float to 7 significant
// digits and a double to 15, then rounds half away from zero on those digits.

export const FLOAT = 7;
export const DOUBLE = 15;

// value = 0.DIGITS x 10^exp, DIGITS has `sig` digits.
function decompose(v, sig) {
  const [m, e] = Math.abs(v).toExponential(sig - 1).split('e');
  return { digits: m.replace('.', ''), exp: Number(e) + 1 };
}

// C# ToString("F<d>") on a float (sig 7) or double (sig 15).
export function fixed(v, d, sig = DOUBLE) {
  if (!Number.isFinite(v)) return String(v);
  const neg = v < 0;
  let intPart = '0', frac = '';
  if (v !== 0) {
    const { digits, exp } = decompose(v, sig);
    if (exp > 0) {
      intPart = digits.slice(0, exp).padEnd(exp, '0');
      frac = digits.slice(exp);
    } else {
      frac = '0'.repeat(-exp) + digits;
    }
  }
  let keep = intPart + frac.slice(0, d).padEnd(d, '0');
  if (frac.length > d && frac[d] >= '5') {
    keep = (BigInt(keep) + 1n).toString().padStart(keep.length, '0');
  }
  let i = keep.slice(0, keep.length - d).replace(/^0+(?=\d)/, '') || '0';
  const f = keep.slice(keep.length - d);
  const zero = /^0*$/.test(i + f);
  return (neg && !zero ? '-' : '') + i + (d > 0 ? '.' + f : '');
}

// C# ToString() / ToString("G<p>"): float p=7, double p=15.
export function general(v, p = DOUBLE) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const neg = v < 0 ? '-' : '';
  const { digits: raw, exp } = decompose(v, p);
  const digits = raw.replace(/0+$/, '');
  const x = exp - 1; // scientific exponent
  if (x > -5 && x < p) {
    if (exp <= 0) return neg + '0.' + '0'.repeat(-exp) + digits;
    if (digits.length <= exp) return neg + digits.padEnd(exp, '0');
    return neg + digits.slice(0, exp) + '.' + digits.slice(exp);
  }
  const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
  return neg + mant + 'E' + (x < 0 ? '-' : '+') + String(Math.abs(x)).padStart(2, '0');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

// Formats epoch seconds read as UTC (the device stores local wall-clock time).
export function formatUtc(sec, pattern) {
  const t = new Date(sec * 1000);
  const map = {
    yyyy: pad(t.getUTCFullYear(), 4), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k]);
}

// Parses "yyyy-MM-dd HH:mm:ss" as UTC epoch seconds, or null.
export function parseUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const t = new Date(ms);
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) return null;
  return ms / 1000;
}
