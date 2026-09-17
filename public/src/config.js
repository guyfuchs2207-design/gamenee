/** Deployment-level knobs. Everything a rebrand or a re-host needs to touch. */

export const GAME_NAME = "Rankle";
export const GAME_TAGLINE = "Six things. One hidden order.";

/** Appended to the share card. Leave empty to share without a link. */
export const SHARE_URL = "https://rankle.gg";

/**
 * Stats backend origin. Empty string means same-origin (`/api/...`), which is
 * what you get when the Worker also serves the static site.
 * The game is fully playable with the backend unreachable — see api.js.
 */
export const API_BASE = "";

/** How long to wait on the backend before giving up and playing offline. */
export const API_TIMEOUT_MS = 4000;
