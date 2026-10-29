import { useEffect } from "react";

export function usePullToRefresh({ disabled = false } = {}) {
  useEffect(() => {
    let startY = 0;
    let pullDist = 0;
    let eligible = false; // only true when touch started at scrollY === 0
    let indicator = null;

    function showIndicator(pct) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "ptr-indicator";
        document.body.appendChild(indicator);
      }
      const size = Math.round(16 + pct * 24);
      indicator.style.cssText = [
        `position:fixed`,
        `top:${Math.round(pct * 56)}px`,
        `left:50%`,
        `transform:translateX(-50%)`,
        `width:${size}px`,
        `height:${size}px`,
        `border-radius:50%`,
        `border:3px solid rgba(255,255,255,0.3)`,
        `border-top-color:#fff`,
        `animation:ptr-spin 0.7s linear infinite`,
        `background:rgba(255,255,255,0.15)`,
        `backdrop-filter:blur(8px)`,
        `z-index:9999`,
        `opacity:${(0.4 + pct * 0.6).toFixed(2)}`,
      ].join(";");
    }

    function hideIndicator() {
      if (indicator) { indicator.remove(); indicator = null; }
    }

    function onTouchStart(e) {
      if (disabled) return;
      startY = e.touches[0].clientY;
      pullDist = 0;
      eligible = window.scrollY === 0;
    }

    function onTouchMove(e) {
      if (!eligible) return;
      pullDist = e.touches[0].clientY - startY;
      if (pullDist > 0) showIndicator(Math.min(pullDist / 80, 1));
      else hideIndicator();
    }

    function onTouchEnd() {
      hideIndicator();
      if (eligible && pullDist > 70) {
        const flash = document.createElement("div");
        flash.style.cssText = [
          "position:fixed", "inset:0", "z-index:99999",
          "background:#fff", "opacity:0",
          "transition:opacity 0.15s ease",
          "pointer-events:none",
        ].join(";");
        document.body.appendChild(flash);
        // Two rAF frames ensure the browser paints the element before transitioning
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { flash.style.opacity = "1"; });
        });
        setTimeout(() => window.location.reload(), 200);
      }
      pullDist = 0;
      eligible = false;
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove",  onTouchMove,  { passive: true });
    document.addEventListener("touchend",   onTouchEnd,   { passive: true });

    // Inject spin keyframes once
    if (!document.getElementById("ptr-style")) {
      const s = document.createElement("style");
      s.id = "ptr-style";
      s.textContent = "@keyframes ptr-spin{to{transform:translateX(-50%) rotate(360deg)}}";
      document.head.appendChild(s);
    }

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove",  onTouchMove);
      document.removeEventListener("touchend",   onTouchEnd);
      hideIndicator();
    };
  }, [disabled]);
}
