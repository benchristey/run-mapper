import { useEffect, useState } from "react";
import { usePreferencesStore } from "../state/preferences";
import { useRouteStore } from "../state/routeStore";
import {
  ALL_LEG_PROFILES,
  BROUTER_PROFILES,
  LEG_PROFILE_LABELS,
  PROFILE_LABELS,
  type BrouterProfile,
  type LegProfile,
} from "../types";

interface ToolbarProps {
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Omit to hide the in-app library button (e.g. on iPad). */
  onLibrary?: () => void;
  onNew: () => void;
}

type MenuId = "file" | "route" | "settings" | null;

export function Toolbar({ onOpen, onSave, onSaveAs, onLibrary, onNew }: ToolbarProps) {
  const mode = useRouteStore((s) => s.mode);
  const setMode = useRouteStore((s) => s.setMode);
  const pencilMode = useRouteStore((s) => s.pencilMode);
  const setPencilMode = useRouteStore((s) => s.setPencilMode);
  const selectShape = useRouteStore((s) => s.selectShape);
  const setSelectShape = useRouteStore((s) => s.setSelectShape);
  const profile = useRouteStore((s) => s.profile);
  const setProfile = useRouteStore((s) => s.setProfile);
  const setLegProfile = useRouteStore((s) => s.setLegProfile);
  const setLegProfiles = useRouteStore((s) => s.setLegProfiles);
  const undo = useRouteStore((s) => s.undo);
  const redo = useRouteStore((s) => s.redo);
  const reverse = useRouteStore((s) => s.reverse);
  const closeLoop = useRouteStore((s) => s.closeLoop);
  const removeWaypoints = useRouteStore((s) => s.removeWaypoints);
  const selectedIds = useRouteStore((s) => s.selectedIds);
  const waypoints = useRouteStore((s) => s.waypoints);
  const legs = useRouteStore((s) => s.legs);
  const dirty = useRouteStore((s) => s.dirty);
  const fileName = useRouteStore((s) => s.fileName);
  const canUndo = useRouteStore((s) => s.history.length > 0);
  const canRedo = useRouteStore((s) => s.future.length > 0);
  const units = usePreferencesStore((s) => s.units);
  const toggleUnits = usePreferencesStore((s) => s.toggleUnits);

  const pencilEngaged = pencilMode !== "off";
  const selectionCount = selectedIds.length;
  const selectedIndex =
    selectionCount === 1
      ? waypoints.findIndex((wp) => wp.id === selectedIds[0])
      : -1;
  const incomingLegIndex = selectedIndex > 0 ? selectedIndex - 1 : -1;
  const outgoingLegIndex =
    selectedIndex >= 0 && selectedIndex < waypoints.length - 1
      ? selectedIndex
      : -1;
  const selectedIdSet = new Set(selectedIds);
  const selectedLegIndexes =
    selectionCount > 1
      ? legs.flatMap((leg, i) =>
          selectedIdSet.has(leg.fromId) && selectedIdSet.has(leg.toId)
            ? [i]
            : []
        )
      : [];
  const selectedLegProfiles = selectedLegIndexes.map((i) => legs[i]?.profile);
  const selectedLegProfile =
    selectedLegProfiles.length > 0 &&
    selectedLegProfiles.every((p) => p === selectedLegProfiles[0])
      ? selectedLegProfiles[0]
      : null;

  const [menu, setMenu] = useState<MenuId>(null);

  // Menus only close via the toggle buttons themselves — re-tapping the
  // active toggle closes it, and tapping the other toggle switches (which
  // implicitly closes the first). No outside-tap dismiss: tapping the map,
  // bottom panel, or anywhere else leaves the menu alone, so the user can
  // freely interact with the route while the menu stays put. Escape is
  // kept as a keyboard-only convenience.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  // File actions are one-shots — close the menu after each click.
  const fileAction = (fn: () => void | Promise<void>) => () => {
    setMenu(null);
    void fn();
  };
  // Route actions stay open so the user can chain (undo a few times,
  // toggle pin, then delete a node, etc.).
  const routeAction = (fn: () => void | Promise<void>) => () => {
    void fn();
  };

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-20 flex items-start gap-2 px-3 pt-3"
      style={{ paddingTop: "max(env(safe-area-inset-top), 32px)" }}
    >
      {/* Vertical strip — File / Route / Settings toggles. Always visible. */}
      <div className="pointer-events-auto flex flex-col gap-1 rounded-2xl bg-ink-900/85 p-1 shadow-lg backdrop-blur-md ring-1 ring-white/5">
        <ToolbarToggle
          on={menu === "file"}
          onClick={() => setMenu(menu === "file" ? null : "file")}
          aria-haspopup="menu"
          aria-expanded={menu === "file"}
          title="File"
        >
          <IconFile />
          {dirty && (
            <span
              aria-label="unsaved"
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400"
            />
          )}
        </ToolbarToggle>
        <ToolbarToggle
          on={menu === "route"}
          onClick={() => setMenu(menu === "route" ? null : "route")}
          aria-haspopup="menu"
          aria-expanded={menu === "route"}
          title="Route"
        >
          <IconRoute />
        </ToolbarToggle>
        <ToolbarToggle
          on={menu === "settings"}
          onClick={() => setMenu(menu === "settings" ? null : "settings")}
          aria-haspopup="menu"
          aria-expanded={menu === "settings"}
          title="Settings"
        >
          <IconSettings />
        </ToolbarToggle>
      </div>

      {/* Context top bar — only renders when a menu toggle is on. */}
      {menu === "file" && (
        <div
          role="menu"
          className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-ink-900/85 p-1 shadow-lg backdrop-blur-md ring-1 ring-white/5"
        >
          <ToolbarButton onClick={fileAction(onNew)} title="New route">
            <IconPlus />
          </ToolbarButton>
          <ToolbarButton onClick={fileAction(onOpen)} title="Open">
            <IconFolder />
          </ToolbarButton>
          {onLibrary && (
            <ToolbarButton onClick={fileAction(onLibrary)} title="Library">
              <IconLibrary />
            </ToolbarButton>
          )}
          <ToolbarButton
            onClick={fileAction(onSave)}
            title={fileName ? `Save ${fileName}` : "Save"}
          >
            <IconSave />
            {dirty && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400" />
            )}
          </ToolbarButton>
          <ToolbarButton onClick={fileAction(onSaveAs)} title="Save as / Export">
            <IconSaveAs />
          </ToolbarButton>
        </div>
      )}

      {menu === "route" && (
        <div
          role="menu"
          className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-2xl bg-ink-900/85 p-1 shadow-lg backdrop-blur-md ring-1 ring-white/5"
        >
          {/* Finger Pin toggle. Becomes dormant when a Pencil mode is engaged. */}
          <ToolbarToggle
            on={!pencilEngaged && mode === "add"}
            disabled={pencilEngaged}
            onClick={() => setMode(mode === "add" ? "pan" : "add")}
            title={
              pencilEngaged
                ? "Finger taps disabled while a Pencil mode is active"
                : mode === "add"
                  ? "Tap-to-add ON"
                  : "Tap-to-add OFF"
            }
            aria-pressed={!pencilEngaged && mode === "add"}
          >
            <IconPin />
          </ToolbarToggle>

          {/* Pencil mode toggles (mutually exclusive). */}
          <ToolbarToggle
            on={pencilMode === "add"}
            onClick={() => setPencilMode(pencilMode === "add" ? "off" : "add")}
            title="Pencil add: only Apple Pencil drops waypoints; finger pans."
            aria-pressed={pencilMode === "add"}
          >
            <IconPencilAdd />
          </ToolbarToggle>
          <ToolbarToggle
            on={pencilMode === "select"}
            onClick={() => setPencilMode(pencilMode === "select" ? "off" : "select")}
            title="Pencil select: drag a rectangle or lasso to multi-select waypoints."
            aria-pressed={pencilMode === "select"}
          >
            <IconPencilSelect />
          </ToolbarToggle>

          {/* Rect/Lasso sub-toggle, only shown in pencil-select mode. */}
          {pencilMode === "select" && (
            <>
              <div className="mx-0.5 h-7 w-px bg-white/10" />
              <ToolbarToggle
                on={selectShape === "rect"}
                onClick={() => setSelectShape("rect")}
                title="Rectangle selection"
                aria-pressed={selectShape === "rect"}
              >
                <IconRect />
              </ToolbarToggle>
              <ToolbarToggle
                on={selectShape === "lasso"}
                onClick={() => setSelectShape("lasso")}
                title="Lasso selection"
                aria-pressed={selectShape === "lasso"}
              >
                <IconLasso />
              </ToolbarToggle>
            </>
          )}

          <div className="mx-0.5 h-7 w-px bg-white/10" />

          <ToolbarButton
            disabled={!canUndo}
            onClick={routeAction(undo)}
            title="Undo"
          >
            <IconUndo />
          </ToolbarButton>
          <ToolbarButton
            disabled={!canRedo}
            onClick={routeAction(redo)}
            title="Redo"
          >
            <IconRedo />
          </ToolbarButton>
          <ToolbarButton
            disabled={selectionCount === 0}
            onClick={routeAction(() =>
              selectionCount > 0 ? removeWaypoints(selectedIds) : Promise.resolve()
            )}
            title={
              selectionCount === 0
                ? "Select a waypoint to delete"
                : selectionCount === 1
                  ? "Delete selected waypoint"
                  : `Delete ${selectionCount} waypoints`
            }
          >
            <IconTrash />
            {selectionCount > 1 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                {selectionCount}
              </span>
            )}
          </ToolbarButton>

          <div className="mx-0.5 h-7 w-px bg-white/10" />

          <ToolbarButton onClick={routeAction(reverse)} title="Reverse direction">
            <IconReverse />
          </ToolbarButton>
          <ToolbarButton onClick={routeAction(closeLoop)} title="Close as loop">
            <IconLoop />
          </ToolbarButton>

          {selectionCount === 1 && (
            <>
              <div className="mx-0.5 h-7 w-px bg-white/10" />
              {incomingLegIndex >= 0 && (
                <LegProfileSelect
                  id="rm-leg-profile-in"
                  label="In"
                  title="Routing for the leg into the selected waypoint"
                  value={legs[incomingLegIndex]?.profile ?? profile}
                  onChange={(next) =>
                    void setLegProfile(incomingLegIndex, next)
                  }
                />
              )}
              {outgoingLegIndex >= 0 && (
                <LegProfileSelect
                  id="rm-leg-profile-out"
                  label="Out"
                  title="Routing for the leg out of the selected waypoint"
                  value={legs[outgoingLegIndex]?.profile ?? profile}
                  onChange={(next) =>
                    void setLegProfile(outgoingLegIndex, next)
                  }
                />
              )}
            </>
          )}
          {selectionCount > 1 && selectedLegIndexes.length > 0 && (
            <>
              <div className="mx-0.5 h-7 w-px bg-white/10" />
              <LegProfileSelect
                id="rm-leg-profile-selected"
                label={`${selectedLegIndexes.length} legs`}
                title="Routing for legs between selected waypoints"
                value={selectedLegProfile}
                placeholder="Mixed"
                onChange={(next) =>
                  void setLegProfiles(selectedLegIndexes, next)
                }
              />
            </>
          )}

        </div>
      )}

      {menu === "settings" && (
        <div
          role="menu"
          className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl bg-ink-900/85 p-2 shadow-lg backdrop-blur-md ring-1 ring-white/5"
        >
          <label className="inline-flex items-center gap-2 rounded-xl bg-ink-800 px-3 py-2 text-xs font-semibold text-slate-300 ring-1 ring-white/10">
            <span>Units</span>
            <button
              type="button"
              className="rounded-lg bg-ink-900 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-100 ring-1 ring-white/10 hover:bg-white/5 active:bg-white/10"
              onClick={routeAction(toggleUnits)}
              title={
                units === "metric"
                  ? "Showing kilometres/metres. Tap to show miles/feet."
                  : "Showing miles/feet. Tap to show kilometres/metres."
              }
            >
              {units === "metric" ? "km" : "mi"}
            </button>
          </label>

          <label
            className="inline-flex items-center gap-2 rounded-xl bg-ink-800 px-3 py-2 text-xs font-semibold text-slate-300 ring-1 ring-white/10"
            htmlFor="rm-default-profile"
          >
            <span>Default routing</span>
            <select
              id="rm-default-profile"
              className="rounded-lg bg-ink-900 px-2 py-1 text-xs font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              value={profile}
              onChange={(e) =>
                void setProfile(e.target.value as BrouterProfile)
              }
            >
              {BROUTER_PROFILES.map((p) => (
                <option key={p} value={p}>
                  {PROFILE_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function LegProfileSelect({
  id,
  label,
  title,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  title: string;
  value: LegProfile | null;
  placeholder?: string;
  onChange: (profile: LegProfile) => void;
}) {
  return (
    <label
      className="inline-flex items-center gap-1 rounded-xl bg-ink-800 px-2 py-1 text-xs font-semibold text-slate-300 ring-1 ring-white/10"
      title={title}
      htmlFor={id}
    >
      <span>{label}</span>
      <select
        id={id}
        className="max-w-36 rounded-lg bg-ink-900 px-2 py-1 text-xs font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value as LegProfile)}
      >
        {value == null && placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {ALL_LEG_PROFILES.map((p) => (
          <option key={p} value={p}>
            {LEG_PROFILE_LABELS[p]}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToolbarButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={
        "relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-200 transition " +
        "ring-1 ring-white/5 hover:bg-white/5 active:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent " +
        className
      }
    >
      {children}
    </button>
  );
}

function ToolbarToggle({
  children,
  on,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      {...rest}
      className={
        "relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition ring-1 " +
        (on
          ? "bg-emerald-500 text-ink-900 ring-emerald-400 shadow-md shadow-emerald-500/30"
          : "text-slate-200 ring-white/5 hover:bg-white/5 active:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent") +
        " " +
        className
      }
    >
      {children}
    </button>
  );
}

// ---- Icons (inline SVGs, 20x20) ----
const ICON_CLS = "h-5 w-5";

function IconPlus() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconFolder() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function IconLibrary() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="4" height="16" rx="1" />
      <rect x="9" y="4" width="4" height="16" rx="1" />
      <path d="M16 6l4 1-3 14-4-1z" />
    </svg>
  );
}
function IconSave() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5a2 2 0 0 1 2-2h10l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      <path d="M8 3v5h7V3" />
      <rect x="8" y="13" width="8" height="6" />
    </svg>
  );
}
function IconSaveAs() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      <path d="M14 3v6h6" />
      <line x1="12" y1="13" x2="12" y2="19" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function IconUndo() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H10" />
    </svg>
  );
}
function IconRedo() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0-5 5v0a5 5 0 0 0 5 5h5" />
    </svg>
  );
}
function IconReverse() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h13l-3-3" />
      <path d="M21 17H8l3 3" />
    </svg>
  );
}
function IconLoop() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="4" r="1.5" fill="currentColor" />
    </svg>
  );
}
function IconFile() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
function IconRoute() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h7a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h7" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.9 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.7 1z" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function IconPencilAdd() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4.5l5 5L9 20H4v-5z" />
      <path d="M12 7l5 5" />
      <path d="M19 18h4M21 16v4" />
    </svg>
  );
}
function IconPencilSelect() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4.5l5 5L9 20H4v-5z" />
      <path d="M12 7l5 5" />
      <path
        d="M3 13c0 4 3 7 7 7"
        strokeDasharray="2 3"
      />
    </svg>
  );
}
function IconRect() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="1" strokeDasharray="3 2" />
    </svg>
  );
}
function IconLasso() {
  return (
    <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 9c0-3 3-5 7-5s7 2 7 5-3 5-7 5c-2 0-3.5-.5-4.5-1.2" strokeDasharray="3 2" />
      <path d="M7.5 12.8c-1 1-1.5 2.2-1.5 3.2 0 1.5 1.5 3 3 3" />
      <circle cx="9" cy="19" r="1.5" />
    </svg>
  );
}
