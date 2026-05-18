/**
 * Platform / capability sniffing.
 *
 * Used to gate UX whose semantics differ on Apple touch devices — most
 * importantly, file storage: desktop browsers persist routes in an
 * IndexedDB-backed library, but on iPad we route everything through the
 * Files app so users get real `.gpx` files in iCloud Drive / On My iPad.
 */

export function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ UA-spoofs as macOS; distinguish by touch support.
  return ua.includes("Mac") && "ontouchend" in document;
}
