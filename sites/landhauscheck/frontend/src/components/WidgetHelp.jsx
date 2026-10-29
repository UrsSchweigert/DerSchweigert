import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

const POPUP_WIDTH = 220;
const VIEWPORT_PAD = 8;

/**
 * WidgetHelp — a small circled "?" button that shows a tooltip popup.
 * The popup is rendered via a React portal at document.body so it escapes
 * any overflow:hidden ancestor (widget containers all use overflow:hidden).
 * Position is calculated from the button's getBoundingClientRect and clamped
 * to the viewport, so it never overflows left or right in any language.
 */
export default function WidgetHelp({ text }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popupRef = useRef(null);

  // Calculate portal position from the button's viewport rect before paint.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const top = r.bottom + window.scrollY + 8;
    // Default: right-anchored — popup right edge aligns with button right edge.
    let left = r.right + window.scrollX - POPUP_WIDTH;
    // Clamp: if popup would exit left edge, anchor to button left instead.
    if (left < VIEWPORT_PAD) left = r.left + window.scrollX;
    // Clamp: if popup still exits right edge, pull it back.
    if (left + POPUP_WIDTH > window.innerWidth - VIEWPORT_PAD) {
      left = window.innerWidth - POPUP_WIDTH - VIEWPORT_PAD;
    }
    setStyle({ top, left: Math.max(VIEWPORT_PAD, left) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e) {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        popupRef.current && !popupRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="widgetHelp" ref={wrapRef}>
      <button
        ref={btnRef}
        className="widgetHelp__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Info"
        aria-expanded={open}
        type="button"
      >
        ?
      </button>
      {open && createPortal(
        <span
          ref={popupRef}
          className="widgetHelp__popup"
          role="tooltip"
          style={{ top: style.top, left: style.left }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
