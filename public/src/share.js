/**
 * The share card.
 *
 * One attempt means one line of squares — the card states a score and shows
 * which slots landed, and nothing else. No item, metric or value appears in
 * it, so posting your result cannot spoil the puzzle for anyone who has not
 * played it yet. There is a test that enforces exactly that.
 */
import { GAME_NAME, SHARE_URL } from "./config.js";
import { ITEMS_PER_PUZZLE } from "./engine.js";

const HIT = "🟩";
const MISS = "⬜";

export function marksToRow(marks) {
  return marks.map((hit) => (hit ? HIT : MISS)).join("");
}

export function buildShareText({ number, marks, score, url = SHARE_URL }) {
  const headline = score === ITEMS_PER_PUZZLE
    ? `${GAME_NAME} #${number} — perfect order`
    : `${GAME_NAME} #${number} — ${score}/${ITEMS_PER_PUZZLE} in place`;
  return [headline, "", marksToRow(marks), url].filter(Boolean).join("\n");
}

/**
 * Share via the native sheet where available, otherwise the clipboard.
 * @returns {Promise<"shared"|"copied"|"failed">}
 */
export async function shareResult(text) {
  // Desktop Chrome advertises navigator.share but often cannot handle
  // text-only payloads, so check canShare first where it exists.
  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ text }));

  if (canNativeShare) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      // Dismissing the sheet is a cancel, not a failure worth falling back from.
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
