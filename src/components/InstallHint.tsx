import { useIosInstallHint } from "../hooks/useInstallHint";

export function InstallHint() {
  const { show, dismiss } = useIosInstallHint();
  if (!show) return null;
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 mx-auto mb-3 w-full max-w-md px-3"
         style={{ marginBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
      <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/95 p-3 text-ink-900 shadow-lg">
        <div className="mt-0.5">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4" />
            <path d="M8 8l4-4 4 4" />
            <path d="M4 20h16" />
          </svg>
        </div>
        <div className="flex-1 text-sm leading-snug">
          <strong className="block font-semibold">Install RunMapper</strong>
          Tap the share icon, then “Add to Home Screen” for the best experience.
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => dismiss(false)}
            className="rounded-md px-2 py-1 text-xs font-medium hover:bg-black/10"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="rounded-md px-2 py-1 text-xs font-medium hover:bg-black/10"
          >
            Don’t show again
          </button>
        </div>
      </div>
    </div>
  );
}
