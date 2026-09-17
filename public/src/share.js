/**
 * The share card — the actual growth engine.
 *
 * Rules it has to obey: reveal the shape of the round but never the answer,
 * survive being pasted into any chat app as plain text, and stay short enough
 * that nothing gets truncated.
 */
import { EXACT, NEAR, MAX_TRIES } from "./engine.js";

const SQUARE = { [EXACT]: "🟩", [NEAR]: "🟨" };
const FAR_SQUARE_LIGHT = "⬜";
const FAR_SQUARE_DARK = "⬛";

export function marksToRow(marks, dark = false) {
  const far = dark ? FAR_SQUARE_DARK : FAR_SQUARE_LIGHT;
  return marks.map((m) => SQUARE[m] || far).join("");
}

/**
 * Build the shareable text.
 * Deliberately contains no item labels and no metric — a friend who has not
 * played yet learns nothing but how hard you found it.
 */
export function buildShareText({ number, rows, won, dark = false, url = "" }) {
  const score = won ? `${rows.length}/${MAX_TRIES}` : `X/${MAX_TRIES}`;
  const grid = rows.map((r) => marksToRow(r.marks, dark)).join("\n");
  return [`Rankle #${number} ${score}`, "", grid, url].filter(Boolean).join("\n");
}

/**
 * Share via the native sheet where available, otherwise the clipboard.
 * @returns {Promise<"shared"|"copied"|"failed">}
 */
export async function shareResult(text) {
  // Desktop Chrome advertises navigator.share but often cannot handle text-only
  // payloads, so check canShare first where it exists.
  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ text }));

  if (canNativeShare) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      // The user dismissing the sheet is a cancel, not a failure to fall back from.
      if (err && err.name === "AbortError") return "shared";
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:absolute;left:-9999px;top:0;";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok ? "copied" : "failed";
  } catch {
    return "failed";
  }
}
