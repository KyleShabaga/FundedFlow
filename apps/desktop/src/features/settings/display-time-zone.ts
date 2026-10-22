// The app-wide display time zone (P0-D05). It is stored once, in the local settings table, as a mode: "desktop"
// follows the computer's zone (re-read when the window regains focus), "zone" keeps one named IANA zone. It only
// changes how instants read; stored instants, import zones, account zones and trading days are untouched.
import { useSyncExternalStore } from "react";
import { z } from "zod";

import { desktopTimeZone, isSupportedTimeZone, timeZoneDisplayName } from "../../design-system";
import { useSetSetting, useSetting } from "./hooks/settings";

export const DISPLAY_TIME_ZONE_SETTING = "display.time_zone";

export const displayTimeZoneSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("desktop") }),
  z.object({ mode: z.literal("zone"), zone: z.string().min(1) }),
]);
export type DisplayTimeZonePreference = z.infer<typeof displayTimeZoneSchema>;

export type DisplayTimeZone =
  /** The preference is still being read: show no converted time yet rather than one that may change. */
  | { kind: "loading" }
  | {
      kind: "resolved";
      /** The IANA zone to format in; undefined when the runtime names no desktop zone (Intl then uses its default). */
      zone: string | undefined;
      /** desktop: following the computer. chosen: the saved zone. fallback: the saved zone can't be used, so desktop. */
      source: "desktop" | "chosen" | "fallback";
      /** Why the saved preference isn't used (fallback only). */
      problem?: "unsupported-zone" | "unreadable";
      /** The saved zone that isn't supported here (fallback, unsupported-zone). */
      savedZone?: string;
    };

/** No saved preference means desktop mode: existing users keep following their computer. */
export function resolveDisplayTimeZone(stored: unknown, desktop: string | null): Extract<DisplayTimeZone, { kind: "resolved" }> {
  const zone = desktop ?? undefined;
  if (stored === null || stored === undefined) return { kind: "resolved", zone, source: "desktop" };
  const parsed = displayTimeZoneSchema.safeParse(stored);
  if (!parsed.success) return { kind: "resolved", zone, source: "fallback", problem: "unreadable" };
  if (parsed.data.mode === "desktop") return { kind: "resolved", zone, source: "desktop" };
  if (!isSupportedTimeZone(parsed.data.zone)) return { kind: "resolved", zone, source: "fallback", problem: "unsupported-zone", savedZone: parsed.data.zone };
  return { kind: "resolved", zone: parsed.data.zone, source: "chosen" };
}

// The desktop zone is re-read when the window regains focus or becomes visible, so desktop mode follows a change
// made in Windows while the app was in the background. A chosen zone ignores it.
function subscribeDesktopZone(onChange: () => void) {
  const onVisible = () => { if (document.visibilityState === "visible") onChange(); };
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** The computer's zone, kept current across focus changes. */
export function useDesktopTimeZone(): string | null {
  return useSyncExternalStore(subscribeDesktopZone, desktopTimeZone, desktopTimeZone);
}

export function useDisplayTimeZone(): DisplayTimeZone {
  const setting = useSetting(DISPLAY_TIME_ZONE_SETTING);
  const desktop = useDesktopTimeZone();
  // A preference that can't be read is not a reason to hide times: show desktop time and say so.
  if (setting.data === undefined && (setting.error === null || setting.isRuntimePending)) return { kind: "loading" };
  if (setting.data === undefined) return { kind: "resolved", zone: desktop ?? undefined, source: "fallback", problem: "unreadable" };
  return resolveDisplayTimeZone(setting.data?.value ?? null, desktop);
}

export function useSaveDisplayTimeZone() {
  const save = useSetSetting(DISPLAY_TIME_ZONE_SETTING);
  return {
    save: (preference: DisplayTimeZonePreference) => save.submit(displayTimeZoneSchema.parse(preference)),
    isSaving: save.isPending,
    error: save.error,
  };
}

/** "Europe/London (your computer's time zone)": names the zone in words, never only an abbreviation. */
export function displayZoneName(display: Extract<DisplayTimeZone, { kind: "resolved" }>): string {
  const name = display.zone ? timeZoneDisplayName(display.zone) : "this computer's time zone";
  if (display.source === "chosen") return name;
  return display.zone ? `${name} (this computer's time zone)` : name;
}
