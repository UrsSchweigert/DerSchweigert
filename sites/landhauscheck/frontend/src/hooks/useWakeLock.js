import { useEffect, useRef, useState } from "react";

export function useWakeLock() {
  const [wakeLockStatus, setWakeLockStatus] = useState("unsupported");
  const wakeLockRef = useRef(null);

  useEffect(() => {
    if (!("wakeLock" in navigator)) {
      setWakeLockStatus("unsupported");
      return;
    }
    let released = false;

    async function acquireWakeLock() {
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        setWakeLockStatus("active");
        wakeLockRef.current.addEventListener("release", () => {
          if (!released) setWakeLockStatus("released");
        });
      } catch {
        setWakeLockStatus("denied");
      }
    }

    acquireWakeLock();

    // Re-acquire after tab becomes visible again (e.g. TV switches input)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") acquireWakeLock();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockRef.current?.release();
    };
  }, []);

  return { wakeLockStatus };
}
