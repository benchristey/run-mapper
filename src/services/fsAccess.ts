/**
 * Thin wrapper around the File System Access API with download/upload fallback
 * for browsers that lack it (notably iPad/iPhone Safari).
 */

import { isIos } from "../utils/platform";

const GPX_TYPES: FilePickerAcceptType[] = [
  {
    description: "GPX route",
    accept: { "application/gpx+xml": [".gpx"], "application/xml": [".gpx"] },
  },
];

export const supportsFsAccess = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.showOpenFilePicker === "function" &&
  typeof window.showSaveFilePicker === "function";

export interface OpenedFile {
  text: string;
  fileName: string;
  handle: FileSystemFileHandle | null;
}

/**
 * Open a GPX file. Uses the FS Access API where possible (yielding a handle for "Save"),
 * otherwise falls back to a transient `<input type="file">`.
 */
export async function openGpxFile(): Promise<OpenedFile | null> {
  if (supportsFsAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: GPX_TYPES,
        multiple: false,
        excludeAcceptAllOption: false,
      });
      const file = await handle.getFile();
      const text = await file.text();
      return { text, fileName: file.name, handle };
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    }
  }
  // Fallback: transient input.
  return await openViaInput();
}

function openViaInput(): Promise<OpenedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    // iOS Safari uses UTIs internally for `accept` and doesn't recognize
    // `.gpx` or our MIME types — every `.gpx` shows up greyed out. Skip the
    // filter on iOS and let `parseGpx` validate the chosen file. Desktop
    // browsers keep the filter for nicer UX.
    if (!isIos()) {
      input.accept = ".gpx,application/gpx+xml,application/xml,text/xml";
    }
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const text = await file.text();
          resolve({ text, fileName: file.name, handle: null });
        } catch (err) {
          reject(err);
        } finally {
          input.remove();
        }
      },
      { once: true }
    );
    // Some browsers don't fire 'cancel' reliably; we just rely on change being fired
    // when a file IS chosen, and resolve null elsewhere via the user dismissing.
    input.click();
  });
}

/**
 * Save GPX text to an existing handle, falling back to a download.
 */
export async function saveToHandle(
  handle: FileSystemFileHandle,
  text: string
): Promise<void> {
  // The createWritable call will prompt for permission once per session if needed.
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * Save As: pick a file and write to it. Returns the new handle when supported.
 * Without FS Access, triggers a browser download.
 */
export async function saveGpxAs(
  text: string,
  suggestedName: string
): Promise<{ handle: FileSystemFileHandle | null; fileName: string } | null> {
  const safeName = ensureGpxExtension(suggestedName);
  if (supportsFsAccess()) {
    try {
      const handle = await window.showSaveFilePicker!({
        types: GPX_TYPES,
        suggestedName: safeName,
      });
      await saveToHandle(handle, text);
      return { handle, fileName: handle.name ?? safeName };
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    }
  }
  triggerDownload(text, safeName);
  return { handle: null, fileName: safeName };
}

function ensureGpxExtension(name: string): string {
  return /\.gpx$/i.test(name) ? name : `${name}.gpx`;
}

/**
 * Share a GPX file via the Web Share API (iOS 15+, Android Chrome).
 *
 * On iPad/iOS this surfaces the system share sheet, which prominently lists
 * "Save to Files" — letting the user pick any folder in iCloud Drive,
 * On My iPad, third-party providers (Google Drive, Dropbox), etc. It's a
 * single-tap improvement over the plain `<a download>` flow, which on iOS
 * Safari requires going to the downloads tray and re-sharing from there.
 *
 * Returns:
 *   - "shared"    user completed the share (file is in their chosen folder)
 *   - "cancelled" user dismissed the share sheet
 *   - "unsupported" Web Share with files isn't available; caller should fall
 *                 back to a plain download.
 */
export async function shareGpxFile(
  text: string,
  fileName: string
): Promise<"shared" | "cancelled" | "unsupported"> {
  if (typeof navigator === "undefined") return "unsupported";
  const safeName = ensureGpxExtension(fileName);
  const file = new File([text], safeName, { type: "application/gpx+xml" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return "unsupported";
  }
  if (!nav.canShare({ files: [file] })) return "unsupported";
  try {
    // CRITICAL: pass ONLY `files`. iOS Safari treats `title`/`text`/`url`
    // as a separate item to share and writes a phantom second file
    // (typically a `.webloc`) alongside the GPX in the user's chosen folder.
    await nav.share({ files: [file] });
    return "shared";
  } catch (err) {
    if (isAbortError(err)) return "cancelled";
    // Some platforms throw NotAllowedError when called outside a user
    // gesture, or when the share sheet is busy. Treat as unsupported so
    // the caller falls back to a download.
    return "unsupported";
  }
}

/**
 * Plain download. Useful as a last-resort fallback or when the caller
 * explicitly wants a file in the browser's downloads, not the share sheet.
 */
export function downloadGpxFile(text: string, fileName: string): void {
  triggerDownload(text, ensureGpxExtension(fileName));
}

function triggerDownload(text: string, fileName: string) {
  const blob = new Blob([text], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.name === "NotAllowedError")
  );
}
