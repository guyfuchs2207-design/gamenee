/**
 * Rankle — app controller.
 *
 * Owns the day's state, renders it, and mediates between the drag list, the
 * engine and persistence. The board is small enough (6 rows) that a full
 * re-render on every change is cheaper than diffing, and far easier to reason
 * about — but never while a drag is in flight.
 */
import {
  MAX_TRIES, EXACT, NEAR,
  puzzleNumber, localDateKey, selectPuzzle, openingOrder,
  gradeGuess, isSolved, exactCount,
} from "./engine.js";
import { GAME_NAME, GAME_TAGLINE, SHARE_URL } from "./config.js";
import { loadLocalPuzzles } from "./pack.js";
import { createDragList } from "./dragList.js";
import { loadStats, recordResult, loadProgress, saveProgress, resetEverything } from "./storage.js";
import { buildShareText, shareResult, marksToRow } from "./share.js";
import { fetchDaily, submitResult, fetchStats } from "./api.js";

const REVEAL_STAGGER_MS = 95;
const REVEAL_TOTAL_MS = 480;
const SEEN_HELP_KEY = "rankle.seenHelp.v1";

const $ = (id) => document.getElementById(id);
const el = {
  board: $("board"), history: $("history"), submit: $("submit"),
  promptText: $("prompt-text"), promptHint: $("prompt-hint"),
  puzzleNo: $("puzzle-no"), triesLeft: $("tries-left"),
  sheet: $("sheet"), sheetBody: $("sheet-body"), scrim: $("scrim"),
  toast: $("toast"), footnote: $("footnote"),
};

/** @type {{number:number, dateKey:string, puzzle:object, order:number[], rows:{order:number[],marks:number[]}[], status:"playing"|"won"|"lost", marks:number[]|null}} */
let state;
let dragList;
let busy = false; // true during the reveal animation — blocks input
let countdownTimer;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- boot

async function boot() {
  const number = puzzleNumber();
  const dateKey = localDateKey();

  // Prefer the API (serves only today) and fall back to the bundled pack.
  const fromApi = await fetchDaily(number);
  const puzzle = fromApi?.puzzle ?? selectPuzzle(loadLocalPuzzles(), number);

  const saved = loadProgress(dateKey);
  state = {
    number,
    dateKey,
    puzzle,
    // A saved board is only restored for the same puzzle number; anything
    // else (a new day, a cleared cache) starts from the shared opening order.
    order: saved?.number === number ? saved.order : openingOrder(number),
    rows: saved?.number === number ? saved.rows : [],
    status: saved?.number === number ? saved.status : "playing",
    marks: saved?.number === number ? saved.marks : null,
  };

  dragList = createDragList(el.board, {
    onReorder: handleReorder,
    isLocked: () => busy || state.status !== "playing",
  });

  wireChrome();
  render();

  if (state.status !== "playing") {
    fetchStats(number).then((global) => {
      if (!global) return;
      state.global = global;
      renderGlobal(global);
    });
    openSheet(resultSheet());
  } else if (!readSeenHelp()) {
    try { localStorage.setItem(SEEN_HELP_KEY, "1"); } catch { /* private mode */ }
    openSheet(helpSheet());
  }
}

function readSeenHelp() {
  try { return localStorage.getItem(SEEN_HELP_KEY); } catch { return null; }
}

function wireChrome() {
  document.querySelector('[data-open="help"]').addEventListener("click", () => openSheet(helpSheet()));
  document.querySelector('[data-open="stats"]').addEventListener("click", () => openSheet(statsSheet()));
  el.scrim.addEventListener("click", closeSheet);
  el.sheet.querySelector("[data-close]").addEventListener("click", closeSheet);
  el.submit.addEventListener("click", () => {
    if (state.status === "playing") submit();
    else openSheet(resultSheet());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.sheet.hidden) closeSheet();
  });
  el.footnote.textContent = `${GAME_TAGLINE} New puzzle daily.`;
}

// ---------------------------------------------------------------- state

function handleReorder(nextOrder) {
  state.order = nextOrder;
  // Colours from the previous guess describe an arrangement that no longer
  // exists, so they are dropped the instant anything moves.
  state.marks = null;
  persist();
  render();
}

function persist() {
  saveProgress({
    dateKey: state.dateKey, number: state.number,
    order: state.order, rows: state.rows,
    status: state.status, marks: state.marks,
  });
}

async function submit() {
  if (busy || state.status !== "playing") return;

  const marks = gradeGuess(state.order);
  const solved = isSolved(marks);

  // Guard against burning a try on a board that was already submitted verbatim.
  if (state.rows.some((r) => r.order.join() === state.order.join())) {
    toast("You already tried that order");
    el.board.classList.add("is-shaking");
    setTimeout(() => el.board.classList.remove("is-shaking"), 520);
    return;
  }

  busy = true;
  el.submit.disabled = true;
  state.rows.push({ order: state.order.slice(), marks });
  state.marks = marks;

  await revealRow(marks);

  if (solved) state.status = "won";
  else if (state.rows.length >= MAX_TRIES) state.status = "lost";

  busy = false;
  persist();
  render();

  if (state.status === "playing") {
    toast(`${exactCount(marks)} of 6 in place`);
    return;
  }

  if (state.status === "won") {
    Array.from(el.board.children).forEach((row, i) => {
      setTimeout(() => {
        row.classList.add("is-winning");
        setTimeout(() => row.classList.remove("is-winning"), 440);
      }, i * 70);
    });
  }

  const stats = recordResult({
    number: state.number,
    won: state.status === "won",
    tries: state.rows.length,
  });

  // The sheet opens on local data and upgrades in place if the API answers —
  // which may be before or after it is on screen, so the result is stored.
  submitResult({ number: state.number, won: state.status === "won", tries: state.rows.length })
    .then((global) => {
      if (!global) return;
      state.global = global;
      renderGlobal(global);
    });

  setTimeout(() => openSheet(resultSheet({ stats })), state.status === "won" ? 900 : 600);
}

/** Flip the graded rows in sequence so the result reads as an event, not a repaint. */
function revealRow(marks) {
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

function applyMark(row, mark) {
  row.classList.remove("is-exact", "is-near", "is-far");
  if (mark === EXACT) row.classList.add("is-exact");
  else if (mark === NEAR) row.classList.add("is-near");
  else row.classList.add("is-far");
}

// ---------------------------------------------------------------- render

function render() {
  const { puzzle, number, rows, order, marks, status } = state;

  el.puzzleNo.textContent = `${GAME_NAME} #${number}`;
  el.promptText.textContent = puzzle.prompt;
  el.promptHint.textContent = puzzle.hint;

  const left = MAX_TRIES - rows.length;
  el.triesLeft.textContent =
    status === "won" ? `Solved in ${rows.length}`
    : status === "lost" ? "Out of tries"
    : `${left} ${left === 1 ? "try" : "tries"} left`;

  el.board.classList.toggle("is-locked", status !== "playing");
  el.board.innerHTML = "";

  const answerNames = puzzle.items;
  order.forEach((item, slot) => {
    const li = document.createElement("li");
    li.className = "row";
    li.dataset.row = "";
    li.dataset.item = String(item);
    li.tabIndex = status === "playing" ? 0 : -1;
    li.setAttribute("aria-label",
      `Position ${slot + 1} of 6: ${answerNames[item].label}`);
    li.innerHTML =
      `<span class="row__rank">${slot + 1}</span>` +
      `<span class="row__label">${esc(answerNames[item].label)}</span>` +
      `<span class="row__grip" aria-hidden="true"><i></i><i></i><i></i></span>`;
    if (marks) applyMark(li, marks[slot]);
    el.board.appendChild(li);
  });

  el.history.innerHTML = rows
    .map((r) => `<div class="history__row">${r.marks
      .map((m) => `<span class="pip ${m === EXACT ? "pip--exact" : m === NEAR ? "pip--near" : ""}"></span>`)
      .join("")}</div>`)
    .join("");

  el.submit.disabled = busy;
  el.submit.textContent = status === "playing" ? "Submit ranking" : "See results";
}

// ---------------------------------------------------------------- sheets

function openSheet(html) {
  el.sheetBody.innerHTML = html;
  el.sheet.hidden = false;
  el.scrim.hidden = false;
  bindSheet();
  el.sheet.querySelector("[data-close]").focus();
}

function closeSheet() {
  el.sheet.hidden = true;
  el.scrim.hidden = true;
  clearInterval(countdownTimer);
}

function bindSheet() {
  el.sheetBody.querySelector("[data-share]")?.addEventListener("click", onShare);
  el.sheetBody.querySelector("[data-reset]")?.addEventListener("click", () => {
    if (!confirm("Erase your streak and all statistics? This cannot be undone.")) return;
    resetEverything();
    closeSheet();
    location.reload();
  });
  const cd = el.sheetBody.querySelector("[data-countdown]");
  if (cd) startCountdown(cd);
}

async function onShare() {
  const text = buildShareText({
    number: state.number,
    rows: state.rows,
    won: state.status === "won",
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    url: SHARE_URL,
  });
  const outcome = await shareResult(text);
  if (outcome === "copied") toast("Copied to clipboard");
  else if (outcome === "failed") toast("Couldn't copy — select and copy manually");
}

function resultSheet({ stats = loadStats() } = {}) {
  const { puzzle, rows, status, number } = state;
  const won = status === "won";
  const heading = won
    ? ["Nailed it.", "Clean.", "Impressive.", "Got there."][Math.min(rows.length - 1, 3)]
    : "Not this time.";
  const sub = won
    ? `Solved ${GAME_NAME} #${number} in ${rows.length} ${rows.length === 1 ? "try" : "tries"}.`
    : `The order was tougher than it looked.`;

  const grid = rows.map((r) => marksToRow(r.marks, true)).join("<br>");

  const answer = puzzle.items
    .map((item, i) =>
      `<li><span>${i + 1}</span><b>${esc(item.label)}</b><em>${esc(item.value)}</em>` +
      (item.note ? `<i>${esc(item.note)}</i>` : "") + `</li>`)
    .join("");

  return `
    <h2>${heading}</h2>
    <p>${sub}</p>
    <div style="font-size:1.1rem;line-height:1.5;letter-spacing:2px;margin:14px 0">${grid}</div>

    <h3>The real order — ${esc(puzzle.prompt.toLowerCase())}</h3>
    <ol class="answer">${answer}</ol>
    <p class="fact">${esc(puzzle.fact)}</p>
    <p class="source">Source: ${esc(puzzle.source)}</p>

    <div id="global-slot">${state.global ? globalLine(state.global) : ""}</div>

    ${statsBlock(stats)}

    <div class="countdown"><span>Next puzzle in</span><b data-countdown>--:--:--</b></div>
    <button class="btn btn--share" data-share>Share result</button>
  `;
}

function statsBlock(stats) {
  const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const counts = [1, 2, 3, 4].map((n) => stats.distribution[n] || 0);
  const max = Math.max(1, ...counts);
  const current = state?.status === "won" ? state.rows.length : null;

  const bars = [1, 2, 3, 4]
    .map((n) => {
      const v = stats.distribution[n] || 0;
      const pct = Math.max(9, Math.round((v / max) * 100));
      return `<div class="dist__row"><span>${n}</span>` +
        `<div class="dist__bar ${current === n ? "is-current" : ""}" style="width:${pct}%">${v}</div></div>`;
    })
    .join("");

  return `
    <h3>Your statistics</h3>
    <div class="statgrid">
      <div><b>${stats.played}</b><span>Played</span></div>
      <div><b>${winRate}</b><span>Win %</span></div>
      <div><b>${stats.currentStreak}</b><span>Current streak</span></div>
      <div><b>${stats.maxStreak}</b><span>Max streak</span></div>
    </div>
    <h3>Guess distribution</h3>
    <div class="dist">${bars}</div>
  `;
}

/** Upgrade the open sheet with the day's global numbers, if the API answered. */
function globalLine(global) {
  if (!global?.total) return "";
  const players = global.total.toLocaleString();
  const line = state.status === "won"
    ? `You beat <b>${Math.round(global.percentile)}%</b> of ${players} players today.`
    : `<b>${Math.round((global.solvedRate ?? 0) * 100)}%</b> of ${players} players solved it today.`;
  return `<p class="percentile">${line}</p>`;
}

/** Upgrade an already-open sheet, if one happens to be showing. */
function renderGlobal(global) {
  const slot = document.getElementById("global-slot");
  if (slot) slot.innerHTML = globalLine(global);
}

function helpSheet() {
  return `
    <h2>How to play</h2>
    <p>Six things. One hidden order. <strong>Four tries.</strong></p>
    <ul class="rules">
      <li>Drag the rows into the order you think is right, then submit.</li>
      <li>Each row tells you how close that item is to its true position:</li>
    </ul>
    <div class="demo">
      <div class="demo__row is-exact"><span>1</span>Exactly right</div>
      <div class="demo__row is-near"><span>2</span>One place off</div>
      <div class="demo__row is-far"><span>3</span>Two or more places off</div>
    </div>
    <ul class="rules">
      <li>Get all six <b>green</b> to win.</li>
      <li>A new puzzle arrives every day at midnight, your time.</li>
      <li>No signup. No googling. That's cheating and you know it.</li>
    </ul>
    <p style="margin-top:16px">Keyboard: focus a row, press <strong>Space</strong> to lift it,
    <strong>↑ ↓</strong> to move, <strong>Space</strong> to drop.</p>
  `;
}

function statsSheet() {
  return `
    <h2>Statistics</h2>
    ${statsBlock(loadStats())}
    <div class="countdown"><span>Next puzzle in</span><b data-countdown>--:--:--</b></div>
    ${state.status !== "playing" ? `<button class="btn btn--share" data-share>Share result</button>` : ""}
    <button class="btn btn--ghost" data-reset style="margin-top:10px">Reset statistics</button>
  `;
}

function startCountdown(node) {
  clearInterval(countdownTimer);
  const tick = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    let s = Math.max(0, Math.floor((midnight - now) / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    node.textContent = `${h}:${m}:${sec}`;
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
