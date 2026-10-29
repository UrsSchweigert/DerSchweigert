import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { translations } from "../config/i18n";

/**
 * Pick the best navigation URL for the current platform:
 *   iOS     → maps:// deeplink  (opens Apple Maps directly)
 *   Android → geo: URI / google.navigation intent
 *   Desktop → Google Maps web
 *
 * travelMode: "driving" (default) | "walking"
 */
function getNavUrl(lat, lng, name, travelMode = "driving") {
  const ua = navigator.userAgent;
  const walking = travelMode === "walking";
  if (/iPad|iPhone|iPod/.test(ua)) {
    // dirflg=d → driving, dirflg=w → walking
    return `maps://?daddr=${lat},${lng}&dirflg=${walking ? "w" : "d"}`;
  }
  if (/Android/.test(ua)) {
    if (walking) {
      // google.navigation mode=w triggers Google Maps walking on Android
      return `google.navigation:q=${lat},${lng}&mode=w`;
    }
    return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${walking ? "walking" : "driving"}`;
}

/**
 * NavPromptSheet — portals to document.body so position:fixed covers the
 * full viewport regardless of parent overflow / backdrop-filter contexts.
 *
 * Props:
 *   name        — display name of the destination
 *   lat / lng   — destination coordinates
 *   lang        — "de" | "en" | "pt"  (default: "de")
 *   travelMode  — "driving" (default) | "walking"
 *   onDismiss   — called when sheet closes
 */
export default function NavPromptSheet({ name, lat, lng, lang = "de", travelMode = "driving", onDismiss }) {
  const [visible, setVisible] = useState(false);
  const t = translations[lang] ?? translations.de;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 250);
  };

  const openNav = () => {
    const url = getNavUrl(lat, lng, name, travelMode);
    const isMobile = /iPad|iPhone|iPod|Android/.test(navigator.userAgent);
    if (isMobile) {
      // location.href triggers native app intents — not subject to popup blockers
      window.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    dismiss();
  };

  return createPortal(
    <div
      className={`navPrompt${visible ? " navPrompt--visible" : ""}`}
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label={t.navPromptTitle}
    >
      <div className="navPrompt__sheet" onClick={(e) => e.stopPropagation()}>
        <p className="navPrompt__title">{t.navPromptTitle}</p>
        <p className="navPrompt__dest">{name}</p>
        <button className="navPrompt__open" onClick={openNav}>{t.navOpen}</button>
        <button className="navPrompt__cancel" onClick={dismiss}>{t.navCancel}</button>
      </div>
    </div>,
    document.body
  );
}
