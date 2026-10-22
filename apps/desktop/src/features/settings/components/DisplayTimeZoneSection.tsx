// Settings → Date and time (P0-D05): the display time zone. Desktop mode is saved as a mode, never as the zone the
// computer has today, so it keeps following Windows. Each choice is saved at once; a failed save says so and the
// times keep the zone that was in effect.
import { useMemo, useState } from "react";

import { formatInstant, FormSection, InlineNotice, RadioGroup, SearchField, Select, StatList, supportedTimeZones, timeZoneDisplayName, zoneOffsetLabel } from "../../../design-system";
import { displayZoneName, useDesktopTimeZone, useDisplayTimeZone, useSaveDisplayTimeZone } from "../display-time-zone";
import "./settings.css";

type Mode = "desktop" | "zone";

export interface DisplayTimeZoneSectionProps {
  /** The instant the example line shows; default: now. Tests pass a fixed instant. */
  sampleAt?: string;
}

export function DisplayTimeZoneSection({ sampleAt }: DisplayTimeZoneSectionProps) {
  const display = useDisplayTimeZone();
  const desktop = useDesktopTimeZone();
  const { save, isSaving, error } = useSaveDisplayTimeZone();
  const [query, setQuery] = useState("");
  const [sample] = useState(() => sampleAt ?? new Date().toISOString());
  // Each zone's label carries its offset now; worked out once, not on every keystroke in the search box.
  const zones = useMemo(() => {
    const all = supportedTimeZones();
    return (desktop && !all.includes(desktop) ? [...all, desktop].sort() : all)
      .map(z => ({ value: z, label: `${timeZoneDisplayName(z)} (${zoneOffsetLabel(sample, z)})`, search: `${z} ${timeZoneDisplayName(z)}`.toLowerCase().replace(/_/g, " ") }));
  }, [desktop, sample]);

  const resolved = display.kind === "resolved" ? display : null;
  const mode: Mode | null = resolved ? (resolved.source === "chosen" ? "zone" : "desktop") : null;
  const chosen = resolved?.source === "chosen" ? resolved.zone : undefined;
  const needle = query.trim().toLowerCase().replace(/[\s_]+/g, " ");
  const matches = needle === "" ? zones : zones.filter(z => z.search.includes(needle));
  // The chosen zone stays in the list while a search hides it, so the control never shows a blank value.
  const kept = chosen && !matches.some(z => z.value === chosen) ? zones.find(z => z.value === chosen) : undefined;
  const options = (kept ? [kept, ...matches] : matches).map(({ value, label }) => ({ value, label }));

  const choose = (next: Mode) => {
    if (next === mode) return;
    void save(next === "desktop" ? { mode: "desktop" } : { mode: "zone", zone: chosen ?? desktop ?? "UTC" }).catch(() => undefined);
  };

  const desktopText = desktop ? `${timeZoneDisplayName(desktop)}, ${zoneOffsetLabel(sample, desktop)} now` : "The zone Windows reports";

  return (
    <FormSection headingLevel={2} title="Date and time" description="Changes displayed times. Account trading days and rule calculations use the account's time zone.">
      <RadioGroup<Mode>
        label="Display time zone"
        value={mode}
        disabled={mode === null || isSaving}
        onValueChange={choose}
        options={[
          { value: "desktop", label: "Use desktop time zone", description: `Follows Windows, also when you change it. ${desktopText}.` },
          { value: "zone", label: "Choose time zone", description: "Keeps one zone, whatever Windows is set to." },
        ]}
      />
      {mode === "zone" && (
        <div className="st-zone-picker">
          <SearchField label="Find a time zone" hideLabel={false} value={query} onValueChange={setQuery} placeholder="City or region, e.g. New York" />
          <Select
            label="Time zone"
            options={options}
            value={chosen}
            disabled={isSaving}
            placeholder={matches.length === 0 ? "No zone matches" : "Choose…"}
            onValueChange={zone => { void save({ mode: "zone", zone }).catch(() => undefined); }}
          />
        </div>
      )}
      {resolved?.source === "fallback" && (
        <InlineNotice tone="warning" title={resolved.problem === "unsupported-zone" ? "Saved time zone isn't available" : "Saved time zone couldn't be read"}>
          {resolved.problem === "unsupported-zone" ? `${resolved.savedZone} isn't supported on this computer. ` : ""}
          Times show in this computer's time zone until you choose again.
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error" title="Time zone not saved">
          Your choice couldn't be saved. Times still show in {resolved ? displayZoneName(resolved) : "the zone in effect"}. Try again.
        </InlineNotice>
      )}
      <StatList bordered label="Display time zone in effect" items={[
        { label: "Times show in", value: resolved ? displayZoneName(resolved) : null },
        { label: "Example", value: resolved ? formatInstant(sample, { timeZone: resolved.zone, year: true, zoneName: "offset" }) : null },
      ]} />
    </FormSection>
  );
}
