import { useCallback, useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { MapView } from "./components/MapView";
import { Toolbar } from "./components/Toolbar";
import { RoutePanel } from "./components/RoutePanel";
import { LibraryDrawer } from "./components/LibraryDrawer";
import { InstallHint } from "./components/InstallHint";
import { useRouteStore } from "./state/routeStore";
import { parseGpx, serializeGpx } from "./services/gpx";
import {
  downloadGpxFile,
  openGpxFile,
  saveGpxAs,
  saveToHandle,
  shareGpxFile,
  supportsFsAccess,
} from "./services/fsAccess";
import { saveRoute as saveRouteToLibrary } from "./services/idb";
import { isIos } from "./utils/platform";

// On iPad/iOS we want every save to land in the Files app (iCloud Drive,
// On My iPad, etc.) rather than in an in-browser library, because that's the
// only storage iOS users can actually browse outside Safari. See
// .cursor/rules/ipad-ux.mdc for the full rationale.
const IOS_FILES_ONLY = isIos();

export default function App() {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const loadIntoStore = useRouteStore((s) => s.loadRoute);
  const toRoute = useRouteStore((s) => s.toRoute);
  const fileHandle = useRouteStore((s) => s.fileHandle);
  const fileName = useRouteStore((s) => s.fileName);
  const libraryId = useRouteStore((s) => s.libraryId);
  const markSaved = useRouteStore((s) => s.markSaved);
  const dirty = useRouteStore((s) => s.dirty);
  const clearAll = useRouteStore((s) => s.clearAll);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.warn("SW register error", err);
    },
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const onOpen = useCallback(async () => {
    if (
      dirty &&
      !window.confirm("You have unsaved changes. Open another file anyway?")
    ) {
      return;
    }
    try {
      const opened = await openGpxFile();
      if (!opened) return;
      const route = parseGpx(opened.text, opened.fileName);
      loadIntoStore(route, {
        fileHandle: opened.handle,
        fileName: opened.fileName,
      });
      showToast(`Opened ${opened.fileName}`);
    } catch (err) {
      window.alert(`Could not open file: ${asMessage(err)}`);
    }
  }, [dirty, loadIntoStore, showToast]);

  // Files-app save flow for iPad/iOS: prefer the system share sheet (one tap
  // to "Save to Files"), fall back to a plain download if the Web Share API
  // can't take a file (e.g. older iOS, in-app browser, or Safari with files
  // disabled).
  const saveViaFiles = useCallback(
    async (text: string, fileName: string) => {
      const result = await shareGpxFile(text, fileName);
      if (result === "shared") {
        markSaved({ fileName });
        showToast(`Saved ${fileName} to Files`);
      } else if (result === "cancelled") {
        // User dismissed the share sheet — leave the route dirty.
      } else {
        downloadGpxFile(text, fileName);
        markSaved({ fileName });
        showToast(`Downloaded ${fileName}`);
      }
    },
    [markSaved, showToast]
  );

  const onSave = useCallback(async () => {
    const route = toRoute();
    const text = serializeGpx(route);
    try {
      if (fileHandle) {
        await saveToHandle(fileHandle, text);
        markSaved({});
        showToast("Saved");
        return;
      }
      if (IOS_FILES_ONLY) {
        await saveViaFiles(text, route.name || "route");
        return;
      }
      if (libraryId) {
        const saved = await saveRouteToLibrary(route);
        markSaved({ libraryId: saved.id });
        showToast("Saved to library");
        return;
      }
      // No prior destination — choose based on environment.
      if (supportsFsAccess()) {
        const result = await saveGpxAs(text, route.name || "route");
        if (result) {
          markSaved({ fileHandle: result.handle, fileName: result.fileName });
          showToast(`Saved ${result.fileName}`);
        }
      } else {
        const saved = await saveRouteToLibrary(route);
        markSaved({ libraryId: saved.id });
        showToast("Saved to library");
      }
    } catch (err) {
      window.alert(`Could not save: ${asMessage(err)}`);
    }
  }, [toRoute, fileHandle, libraryId, markSaved, showToast, saveViaFiles]);

  const onSaveAs = useCallback(async () => {
    const route = toRoute();
    const text = serializeGpx(route);
    try {
      if (IOS_FILES_ONLY) {
        await saveViaFiles(text, route.name || "route");
        return;
      }
      const result = await saveGpxAs(text, route.name || "route");
      if (result) {
        markSaved({ fileHandle: result.handle, fileName: result.fileName });
        showToast(supportsFsAccess() ? `Saved ${result.fileName}` : `Downloaded ${result.fileName}`);
      }
    } catch (err) {
      window.alert(`Could not save: ${asMessage(err)}`);
    }
  }, [toRoute, markSaved, showToast, saveViaFiles]);

  const onSaveToLibrary = useCallback(async () => {
    const route = toRoute();
    const saved = await saveRouteToLibrary(route);
    markSaved({ libraryId: saved.id });
    showToast("Saved to library");
  }, [toRoute, markSaved, showToast]);

  const onNew = useCallback(() => {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and start a new route?")
    ) {
      return;
    }
    clearAll();
    showToast("New route");
  }, [dirty, clearAll, showToast]);

  // Warn before unload while there are unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useRouteStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Keyboard shortcuts (desktop hardware keyboards on iPad too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        void onSave();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSaveAs();
      } else if (meta && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void onOpen();
      } else if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void useRouteStore.getState().undo();
      } else if (meta && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        void useRouteStore.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave, onSaveAs, onOpen]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink-950">
      <MapView onToast={showToast} />

      <Toolbar
        onOpen={() => void onOpen()}
        onSave={() => void onSave()}
        onSaveAs={() => void onSaveAs()}
        onLibrary={IOS_FILES_ONLY ? undefined : () => setLibraryOpen(true)}
        onNew={onNew}
      />

      <RoutePanel />

      {!IOS_FILES_ONLY && (
        <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      )}

      <InstallHint />

      {/* Save-to-library quick action when the active doc isn't a file
          (desktop browsers without FS Access). On iPad we always save to
          Files instead, so this is hidden. */}
      {!IOS_FILES_ONLY && (
        <div
          className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-2"
          style={{ marginBottom: "max(env(safe-area-inset-bottom), 8px)" }}
        >
          {!fileName && !libraryId && (
            <button
              type="button"
              onClick={() => void onSaveToLibrary()}
              className="pointer-events-auto rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-ink-900 shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
            >
              Save to library
            </button>
          )}
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-ink-900/90 px-4 py-2 text-sm text-slate-100 shadow-lg ring-1 ring-white/10">
          {toast}
        </div>
      )}

      {needRefresh && (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-30 flex items-center gap-2 rounded-2xl bg-ink-900/95 p-3 text-sm shadow-xl ring-1 ring-white/10">
          <span>New version available.</span>
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-ink-900 hover:bg-emerald-400"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            Later
          </button>
        </div>
      )}
    </div>
  );
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
