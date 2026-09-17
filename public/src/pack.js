/**
 * Decoder for the bundled fallback puzzle pack.
 *
 * The pack is base64 so that "view source" does not hand a curious player
 * every future answer in plain text. This is obfuscation, not security —
 * anyone determined can decode it in one line. The real protection is the
 * API, which only ever serves the current day; the pack exists so the game
 * still works when the API does not.
 */
import { PACK } from "../pack.js";

let cached = null;

export function loadLocalPuzzles() {
  if (cached) return cached;
  const binary = atob(PACK);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  cached = JSON.parse(new TextDecoder().decode(bytes));
  return cached;
}
