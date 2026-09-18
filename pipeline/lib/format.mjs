/**
 * Turns a raw harvested number into the display string the game shows.
 *
 * `value` in the puzzle library is deliberately a string — it has to hold both
 * "1 in 292,201,338" and "243 Earth days" — so formatting happens here, once,
 * at harvest time rather than in the client.
 */

const UNITS = [
  { at: 1e12, suffix: " trillion", div: 1e12 },
  { at: 1e9, suffix: " billion", div: 1e9 },
  { at: 1e6, suffix: " million", div: 1e6 },
];

function trim(n, decimals) {
  return Number(n.toFixed(decimals)).toLocaleString("en-US");
}

/**
 * @param {number} value
 * @param {{kind?: string, prefix?: string, suffix?: string, decimals?: number}} spec
 */
export function formatValue(value, spec = {}) {
  const { kind = "number", prefix = "", suffix = "", decimals = 0 } = spec;

  if (kind === "compact") {
    for (const u of UNITS) {
      if (Math.abs(value) >= u.at) {
        return `${prefix}${trim(value / u.div, 2)}${u.suffix}${suffix}`;
      }
    }
    return `${prefix}${trim(value, decimals)}${suffix}`;
  }

  if (kind === "year") {
    // Years are not thousands-separated; "1,440" reads as a quantity.
    return `${Math.round(value)}`;
  }

  if (kind === "percent") return `${prefix}${trim(value, decimals)}%${suffix}`;

  return `${prefix}${trim(value, decimals)}${suffix}`;
}

/** Wikidata labels arrive with disambiguators and stray whitespace. */
export function cleanLabel(raw) {
  return String(raw)
    .replace(/\s*\([^)]*\)\s*$/, "") // "Mercury (planet)" → "Mercury"
    .replace(/\s+/g, " ")
    .trim();
}
