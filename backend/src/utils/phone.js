// Egyptian phone numbers lose their leading 0 when Excel stores them as numbers
// (01019033661 → 1019033661, 0482590582 → 482590582). Put the 0 back.
//
// A run of digits gets a leading 0 when it does not already start with 0 and either:
//  - it starts with 1 and has 9–10 digits (mobile: 010/011/012/015…), or
//  - it starts with 48 and has 8–10 digits (Menoufia landline, area code 048).
// Anything else (short internal numbers, odd lengths) is left as typed.
// A field can hold several numbers ("1012345678 - 1123456789", "48/2228303"); each one is fixed.

function fixNumber(digits) {
  if (digits.startsWith('0')) return digits;
  const n = digits.length;
  if (digits.startsWith('1') && n >= 9 && n <= 10) return `0${digits}`;
  if (digits.startsWith('48') && n >= 8 && n <= 10) return `0${digits}`;
  return digits;
}

function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return ''; // a phone cell Excel turned into a date — the number is lost
  const s = String(value).trim();
  if (/GMT[+-]\d{4}/.test(s)) return ''; // same, already stored as date text
  return s.replace(/\d+/g, fixNumber);
}

module.exports = { normalizePhone };
