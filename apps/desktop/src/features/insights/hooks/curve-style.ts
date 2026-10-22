// The closed-trade curve's line style (P0-D13): a display preference kept in the local settings table, so it
// survives a restart. Stepped is the default because the running total changes only at each exit. The choice
// changes the drawing only, never the points.
import type { CurveStyle } from "../../../design-system";
import { useSetSetting, useSetting } from "../../settings/hooks/settings";
import { useRef, useState } from "react";

export const CURVE_STYLE_SETTING = "insights.curve_style";

export const parseCurveStyle = (value: unknown): CurveStyle => (value === "smooth" ? "smooth" : "step");

export function useCurveStyle() {
  const setting = useSetting(CURVE_STYLE_SETTING);
  const save = useSetSetting(CURVE_STYLE_SETTING);
  // The click shows at once; the stored value is the default until the trader chooses in this view.
  const [chosen, setChosen] = useState<CurveStyle | null>(null);
  const style = chosen ?? parseCurveStyle(setting.data?.value);
  const wanted = useRef<CurveStyle | null>(null);
  const saving = useRef(false);
  // One save at a time; a choice made while one runs is saved after it. A failed save keeps the choice for this
  // view, and the next visit falls back to the stored value.
  const persist = () => {
    const value = wanted.current;
    if (saving.current || value === null) return;
    saving.current = true;
    save.submit(value).catch(() => {}).finally(() => {
      saving.current = false;
      if (wanted.current !== value) persist();
    });
  };
  const choose = (next: CurveStyle) => {
    setChosen(next);
    wanted.current = next;
    persist();
  };
  return { style, choose };
}
