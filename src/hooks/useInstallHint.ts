import { useEffect, useState } from "react";
import { isIos } from "../utils/platform";

const STORAGE_KEY = "rm-install-hint-dismissed";

/**
 * Shows a one-time hint about adding RunMapper to the iOS/iPadOS Home Screen.
 * Returns whether the hint should currently be displayed, plus a dismiss callback.
 */
export function useIosInstallHint() {
  const [show, show_] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY)) {
      return;
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS specific
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isIos() && !standalone) {
      // Slight delay so the map has settled.
      const t = window.setTimeout(() => show_(true), 1500);
      return () => window.clearTimeout(t);
    }
    return;
  }, []);

  const dismiss = (persist = false) => {
    show_(false);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Ignored: localStorage may be unavailable in private mode.
      }
    } else {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Ignored.
      }
    }
  };

  return { show, dismiss };
}
