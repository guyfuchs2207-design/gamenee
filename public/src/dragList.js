/**
 * Reorderable list built on Pointer Events, so one code path covers mouse,
 * touch and stylus.
 *
 * Rows stay in normal document flow; dragging only ever sets `transform`, and
 * the real DOM order is rewritten once, on drop. That keeps the animation on
 * the compositor and means the list is never in a half-committed state.
 *
 * Keyboard equivalent: focus a row, Space/Enter to lift, arrows to move,
 * Space/Enter to drop, Escape to cancel.
 */

const DRAG_THRESHOLD_PX = 4; // let a tap stay a tap

export function createDragList(container, { onReorder, isLocked = () => false } = {}) {
  let drag = null;
  let lifted = null; // keyboard "picked up" row index

  const rows = () => Array.from(container.querySelectorAll("[data-row]"));

  function rowMetrics() {
    const els = rows();
    if (els.length < 2) return { step: els[0]?.offsetHeight ?? 0, els };
    // Rows are equal-height by design; the gap is whatever sits between two tops.
    return { step: els[1].offsetTop - els[0].offsetTop, els };
  }

  function clearTransforms(els) {
    for (const el of els) {
      el.style.transform = "";
      el.style.transition = "";
      el.classList.remove("is-dragging", "is-shifted");
      el.style.zIndex = "";
    }
  }

  function moveItem(list, from, to) {
    const next = list.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  function currentOrder() {
    return rows().map((el) => Number(el.dataset.item));
  }

  // ---- pointer dragging ----------------------------------------------------

  function onPointerDown(event) {
    if (isLocked()) return;
    // Ignore secondary buttons and anything originating on a real control.
    if (event.button != null && event.button !== 0) return;
    const row = event.target.closest("[data-row]");
    if (!row || !container.contains(row)) return;

    const { step, els } = rowMetrics();
    drag = {
      row,
      pointerId: event.pointerId,
      startY: event.clientY,
      startIndex: els.indexOf(row),
      index: els.indexOf(row),
      step,
      els,
      active: false,
    };
    row.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientY - drag.startY;

    if (!drag.active) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      drag.row.classList.add("is-dragging");
      drag.row.style.zIndex = "10";
      container.classList.add("is-reordering");
    }

    event.preventDefault();

    const { els, step, startIndex } = drag;
    const maxIndex = els.length - 1;
    // Where the dragged row's top edge now sits, in row-steps.
    const target = Math.max(0, Math.min(maxIndex, Math.round(startIndex + delta / step)));

    drag.row.style.transition = "none";
    drag.row.style.transform = `translate3d(0, ${delta}px, 0) scale(1.03)`;

    // Everything between the origin and the target slides one step to fill in.
    for (const [i, el] of els.entries()) {
      if (el === drag.row) continue;
      let shift = 0;
      if (startIndex < target && i > startIndex && i <= target) shift = -step;
      else if (startIndex > target && i >= target && i < startIndex) shift = step;
      el.style.transition = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
      el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
      el.classList.toggle("is-shifted", shift !== 0);
    }
    drag.index = target;
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { active, startIndex, index, els, row } = drag;
    try {
      row.releasePointerCapture(event.pointerId);
    } catch {
      /* capture may already be gone */
    }
    drag = null;
    container.classList.remove("is-reordering");
    clearTransforms(els);
    if (active && index !== startIndex) {
      onReorder?.(moveItem(currentOrder(), startIndex, index), { from: startIndex, to: index });
    }
  }

  // ---- keyboard ------------------------------------------------------------

  function setLifted(index) {
    const els = rows();
    els.forEach((el, i) => el.classList.toggle("is-lifted", i === index));
    els.forEach((el, i) => el.setAttribute("aria-grabbed", String(i === index)));
    lifted = index;
  }

  function onKeyDown(event) {
    if (isLocked()) return;
    const row = event.target.closest("[data-row]");
    if (!row) return;
    const els = rows();
    const index = els.indexOf(row);

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setLifted(lifted === index ? null : index);
      return;
    }

    if (event.key === "Escape" && lifted != null) {
      event.preventDefault();
      setLifted(null);
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    const next = Math.max(0, Math.min(els.length - 1, index + dir));
    if (next === index) return;

    if (lifted === index) {
      onReorder?.(moveItem(currentOrder(), index, next), { from: index, to: next, keyboard: true });
      // Re-render swaps the nodes out; refocus by position, keeping the lift.
      requestAnimationFrame(() => {
        const after = rows()[next];
        after?.focus();
        setLifted(next);
      });
    } else {
      els[next].focus();
    }
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("keydown", onKeyDown);
    },
    clearLift: () => setLifted(null),
  };
}
