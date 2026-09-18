/**
 * Orders — app controller.
 *
 * Owns the currently-viewed puzzle (today's, or one pulled from the archive),
 * renders it, and mediates between the drag list, the engine and persistence.
 * The board is six rows, so a full re-render on every change is cheaper than
 * diffing and far easier to reason about — but never while a drag is in flight.
 */
import {
  ITEMS_PER_PUZZLE, ARCHIVE_DAYS,
  puzzleNumber, dateForNumber, selectPuzzle, openingOrder, archiveNumbers, isPlayable,
  gradeOrder, scoreOrder, isPerfect, placementsByTrueRank,
} from "./engine.js";
import { GAME_NAME, GAME_TAGLINE, SHARE_URL } from "./config.js";
import { loadLocalPuzzles } from "./pack.js";
import { createDragList } from "./dragList.js";
import {
  getPlay, recordPlay, loadPlays, loadDraft, saveDraft, computeStats, resetEverything,
} from "./storage.js";
import { buildShareText, shareResult, marksToRow } from "./share.js";
import { fetchPuzzle, submitScore, fetchStats } from "./api.js";

const REVEAL_STAGGER_MS = 100;
const REVEAL_TOTAL_MS = 460;
const SEEN_HELP_KEY = "orders.seenHelp.v1";

const $ = (id) => document.getElementById(id);
const el = {
  board: $("board"), submit: $("submit"), oneshot: $("oneshot"),
  promptText: $("prompt-text"), promptHint: $("prompt-hint"), puzzleNo: $("puzzle-no"),
  rewind: $("rewind"), rewindLabel: $("rewind-label"),
  sheet: $("sheet"), sheetBody: $("sheet-body"), scrim: $("scrim"),
  toast: $("toast"), footnote: $("footnote"),
};

let state = null;
let busy = false; // true during the reveal animation — blocks input
let countdownTimer;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- boot

async function boot() {
  const todayNumber = puzzleNumber();
  state = { todayNumber, number: todayNumber, puzzle: null, order: [], played: null, marks: null, crowd: null };

  createDragList(el.board, {
    onReorder: handleReorder,
    isLocked: () => busy || !!state.played,
  });

  wireChrome();

  const requested = Number(new URLSearchParams(location.search).get("d"));
  await goTo(isPlayable(requested, todayNumber) ? requested : todayNumber, { replace: true });

  if (!state.played && !readFlag(SEEN_HELP_KEY)) {
    writeFlag(SEEN_HELP_KEY, "1");
    openSheet(helpSheet());
  }
}

function wireChrome() {
  document.querySelector('[data-open="help"]').addEventListener("click", () => openSheet(helpSheet()));
  document.querySelector('[data-open="archive"]').addEventListener("click", () => openSheet(archiveSheet()));
  document.querySelector('[data-open="stats"]').addEventListener("click", () => openSheet(statsSheet()));
  document.querySelector("[data-today]").addEventListener("click", () => goTo(state.todayNumber));
  el.scrim.addEventListener("click", closeSheet);
  el.sheet.querySelector("[data-close]").addEventListener("click", closeSheet);
  el.submit.addEventListener("click", () => (state.played ? openSheet(resultSheet()) : submit()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.sheet.hidden) closeSheet();
  });
  // Back/forward between archive entries.
  window.addEventListener("popstate", (e) => {
    const n = e.state?.number;
    if (isPlayable(n, state.todayNumber)) goTo(n, { skipHistory: true });
  });
  el.footnote.textContent = `${GAME_TAGLINE} New puzzle daily.`;
}

/** localStorage throws outright in some privacy modes — never at boot. */
function readFlag(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeFlag(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- navigation

async function goTo(number, { replace = false, skipHistory = false } = {}) {
  if (busy) return;
  closeSheet();

  // The API serves only released puzzles; the pack is the offline fallback.
  const fromApi = await fetchPuzzle(number);
  const puzzle = fromApi?.puzzle ?? selectPuzzle(loadLocalPuzzles(), number);
  const played = getPlay(number);

  state.number = number;
  state.puzzle = puzzle;
  state.played = played;
  state.crowd = null;
  state.order = played ? played.order.slice() : (loadDraft(number) ?? openingOrder(number));
  state.marks = played ? gradeOrder(played.order) : null;

  if (!skipHistory) {
    const url = number === state.todayNumber ? location.pathname : `?d=${number}`;
    history[replace ? "replaceState" : "pushState"]({ number }, "", url);
  }

  render();

  if (played) {
    fetchStats(number).then((crowd) => {
      if (!crowd) return;
      state.crowd = crowd;
      paintCrowd();
    });
  }
}

// ---------------------------------------------------------------- play

function handleReorder(nextOrder) {
  state.order = nextOrder;
  saveDraft(state.number, nextOrder);
  render();
}

async function submit() {
  if (busy || state.played) return;

  const marks = gradeOrder(state.order);
  const score = marks.filter(Boolean).length;

  busy = true;
  el.submit.disabled = true;
  state.marks = marks;

  await revealRows(marks);

  state.played = recordPlay({ number: state.number, score, order: state.order });
  busy = false;
  render();

  if (isPerfect(score)) {
    Array.from(el.board.children).forEach((row, i) => {
      setTimeout(() => {
        row.classList.add("is-celebrating");
        setTimeout(() => row.classList.remove("is-celebrating"), 440);
      }, i * 70);
    });
  }

  // The sheet opens on local data and upgrades in place if the API answers —
  // which may be before or after it is on screen, so the result is stored.
  submitScore({ number: state.number, score }).then((crowd) => {
    if (!crowd) return;
    state.crowd = crowd;
    paintCrowd();
  });

  setTimeout(() => openSheet(resultSheet()), isPerfect(score) ? 900 : 620);
}

/** Flip the rows in sequence so the result reads as an event, not a repaint. */
function revealRows(marks) {
  return new Promise((resolve) => {
    const rows = Array.from(el.board.children);
    rows.forEach((row, i) => {
      setTimeout(() => {
        row.classList.add("is-revealing");
        // Recolour at the midpoint of the flip, while the row is edge-on.
        setTimeout(() => applyMark(row, marks[i]), REVEAL_TOTAL_MS / 2);
        setTimeout(() => row.classList.remove("is-revealing"), REVEAL_TOTAL_MS);
      }, i * REVEAL_STAGGER_MS);
    });
    setTimeout(resolve, (rows.length - 1) * REVEAL_STAGGER_MS + REVEAL_TOTAL_MS);
  });
}

function applyMark(row, hit) {
  row.classList.remove("is-hit", "is-miss");
  row.classList.add(hit ? "is-hit" : "is-miss");
}

// ---------------------------------------------------------------- render

function render() {
  const { puzzle, number, todayNumber, order, marks, played } = state;
  if (!puzzle) return;

  const isToday = number === todayNumber;
  el.rewind.hidden = isToday;
  if (!isToday) el.rewindLabel.textContent = `Rewind · ${formatDate(dateForNumber(number))}`;

  el.puzzleNo.textContent = `${GAME_NAME} #${number}`;
  el.promptText.textContent = puzzle.prompt;
  el.promptHint.textContent = puzzle.hint;

  el.board.classList.toggle("is-locked", !!played);
  el.board.innerHTML = "";

  order.forEach((item, slot) => {
    const li = document.createElement("li");
    li.className = "row";
    li.dataset.row = "";
    li.dataset.item = String(item);
    li.tabIndex = played ? -1 : 0;
    li.setAttribute("aria-label", `Position ${slot + 1} of 6: ${puzzle.items[item].label}`);
    li.innerHTML =
      `<span class="row__rank">${slot + 1}</span>` +
      `<span class="row__label">${esc(puzzle.items[item].label)}</span>` +
      `<span class="row__grip" aria-hidden="true"><i></i><i></i><i></i></span>`;
    if (marks) applyMark(li, marks[slot]);
    el.board.appendChild(li);
  });

  el.submit.disabled = busy;
  el.submit.textContent = played ? "See the real order" : "Lock in my order";
  el.oneshot.textContent = played
    ? `You scored ${played.score} of ${ITEMS_PER_PUZZLE}.`
    : "One attempt. No takebacks.";
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "Today" / "Yesterday" / a date — what the archive list reads best as. */
function relativeDay(number, todayNumber) {
  if (number === todayNumber) return "Today";
  if (number === todayNumber - 1) return "Yesterday";
  return formatDate(dateForNumber(number));
}

// ---------------------------------------------------------------- sheets

function openSheet(html) {
  el.sheetBody.innerHTML = html;
  el.sheet.hidden = false;
  el.scrim.hidden = false;
  bindSheet();
  el.sheet.scrollTop = 0;
  el.sheet.querySelector("[data-close]").focus();
}

function closeSheet() {
  el.sheet.hidden = true;
  el.scrim.hidden = true;
  clearInterval(countdownTimer);
}

function bindSheet() {
  el.sheetBody.querySelector("[data-share]")?.addEventListener("click", onShare);
  el.sheetBody.querySelector("[data-archive]")?.addEventListener("click", () => openSheet(archiveSheet()));
  el.sheetBody.querySelector("[data-reset]")?.addEventListener("click", () => {
    if (!confirm("Erase your record and every past result? This cannot be undone.")) return;
    resetEverything();
    closeSheet();
    location.reload();
  });
  for (const btn of el.sheetBody.querySelectorAll("[data-goto]")) {
    btn.addEventListener("click", () => goTo(Number(btn.dataset.goto)));
  }
  const cd = el.sheetBody.querySelector("[data-countdown]");
  if (cd) startCountdown(cd);
}

async function onShare() {
  const outcome = await shareResult(
    buildShareText({
      number: state.number,
      marks: state.marks,
      score: state.played.score,
      url: SHARE_URL,
    })
  );
  if (outcome === "copied") toast("Copied to clipboard");
  else if (outcome === "failed") toast("Couldn't copy — select and copy manually");
}

function resultSheet() {
  const { puzzle, number, todayNumber, played, marks } = state;
  const score = played.score;
  const perfect = isPerfect(score);
  const placed = placementsByTrueRank(played.order);

  const headline = perfect
    ? "Perfect order."
    : score >= 4 ? "Close."
    : score >= 2 ? "Partly there."
    : score === 1 ? "One right."
    : "Nothing landed.";

  // The real order, each row carrying the number behind it and — where the
  // player was wrong — where they actually put it.
  const answer = puzzle.items
    .map((item, rank) => {
      const hit = placed[rank] === rank;
      return (
        `<li class="${hit ? "is-hit" : ""}">` +
        `<span>${rank + 1}</span><b>${esc(item.label)}</b><em>${esc(item.value)}</em>` +
        (item.note ? `<i>${esc(item.note)}</i>` : "") +
        (hit ? "" : `<u>you had it ${ordinal(placed[rank] + 1)}</u>`) +
        `</li>`
      );
    })
    .join("");

  return `
    <h2>${headline}</h2>
    <div class="score ${score === 0 ? "is-zero" : ""}">
      <b>${score}</b><span>of ${ITEMS_PER_PUZZLE} in the right place</span>
    </div>
    <div class="scorerow">${marks.map((h) => `<i class="${h ? "is-hit" : ""}"></i>`).join("")}</div>

    <h3>The real order — ${esc(puzzle.prompt.toLowerCase())}</h3>
    <ol class="answer">${answer}</ol>
    <p class="fact">${esc(puzzle.fact)}</p>
    <p class="source">Source: ${esc(puzzle.source)}</p>

    <div id="crowd-slot">${crowdLine()}</div>

    ${recordBlock()}

    ${number === todayNumber
      ? `<div class="countdown"><span>Next puzzle in</span><b data-countdown>--:--:--</b></div>`
      : `<div style="height:20px"></div>`}

    <button class="btn btn--share" data-share>Share result</button>
    <button class="btn btn--ghost" data-archive style="margin-top:10px">Play another day</button>
  `;
}

function ordinal(n) {
  const suffix = ["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th";
  return `${n}${suffix}`;
}

function crowdLine() {
  const c = state.crowd;
  if (!c?.total) return "";
  const players = c.total.toLocaleString();
  const avg = c.averageScore.toFixed(1);
  const beat = Math.round(c.percentile);
  return `<p class="crowd">Average today is <b>${avg}/${ITEMS_PER_PUZZLE}</b> across ${players} players.` +
    (state.played ? ` You beat <b>${beat}%</b> of them.` : "") + `</p>`;
}

/** Upgrade an already-open sheet, if one happens to be showing. */
function paintCrowd() {
  const slot = document.getElementById("crowd-slot");
  if (slot) slot.innerHTML = crowdLine();
}

/**
 * Lifetime record. Four plain numbers — deliberately not a bar chart, because
 * with one attempt per puzzle there is no guess curve to plot.
 */
function recordBlock() {
  const s = computeStats(state.todayNumber);
  return `
    <h3>Your record</h3>
    <div class="statgrid">
      <div><b>${s.played}</b><span>Played</span></div>
      <div><b>${s.played ? s.average.toFixed(1) : "—"}</b><span>Avg score</span></div>
      <div><b>${s.perfect}</b><span>Perfect</span></div>
      <div><b>${s.streak}</b><span>Day streak</span></div>
    </div>
  `;
}

function archiveSheet() {
  const { todayNumber, number: current } = state;
  const plays = loadPlays();

  const items = archiveNumbers(todayNumber, ARCHIVE_DAYS)
    .map((n) => {
      const play = plays[n];
      const badge = play
        ? `<span class="archive__score ${play.score === ITEMS_PER_PUZZLE ? "is-perfect" : ""}">${play.score}/${ITEMS_PER_PUZZLE}</span>`
        : `<span class="archive__score is-new">Play</span>`;
      return `<li><button class="archive__item" data-goto="${n}" aria-current="${n === current}">
          <span><span class="archive__when">${relativeDay(n, todayNumber)}</span>
          <span class="archive__no">${GAME_NAME} #${n}</span></span>${badge}
        </button></li>`;
    })
    .join("");

  return `
    <h2>Past puzzles</h2>
    <p>The last ${Math.min(ARCHIVE_DAYS, todayNumber)} days. Miss one and you can still go back for it — but each puzzle is still a single attempt.</p>
    <ul class="archive">${items}</ul>
  `;
}

function helpSheet() {
  return `
    <h2>How to play</h2>
    <p>Six things. Put them in the right order. <strong>You get one attempt.</strong></p>
    <ul class="rules">
      <li>Drag the rows into the order you think is correct.</li>
      <li>Lock it in. Every item is either in its exact place or it isn't — there's no half credit.</li>
    </ul>
    <div class="demo">
      <div class="demo__row is-hit"><span>1</span>Right place<em>counts</em></div>
      <div class="demo__row is-miss"><span>2</span>Wrong place<em>doesn't</em></div>
    </div>
    <ul class="rules">
      <li>Then you see <b>the real order and the actual numbers</b> behind it. That's the point.</li>
      <li>A new puzzle lands every day at midnight, your time. The last ${ARCHIVE_DAYS} days stay open.</li>
      <li>No signup. No googling. That's cheating and you know it.</li>
    </ul>
    <p style="margin-top:16px">Keyboard: focus a row, press <strong>Space</strong> to lift it,
    <strong>↑ ↓</strong> to move, <strong>Space</strong> to drop.</p>
  `;
}

function statsSheet() {
  const s = computeStats(state.todayNumber);
  return `
    <h2>Your record</h2>
    ${recordBlock()}
    ${s.played ? `<p style="margin-top:14px">Best so far: <strong>${s.best}/${ITEMS_PER_PUZZLE}</strong>.</p>` : `<p style="margin-top:14px">Nothing played yet.</p>`}
    <div class="countdown"><span>Next puzzle in</span><b data-countdown>--:--:--</b></div>
    <button class="btn btn--ghost" data-archive>Past puzzles</button>
    <button class="btn btn--ghost" data-reset style="margin-top:10px">Reset my record</button>
  `;
}

function startCountdown(node) {
  clearInterval(countdownTimer);
  const tick = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const s = Math.max(0, Math.floor((midnight - now) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    node.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------------------------------------------------------------- toast

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), 1900);
}

boot();
