// Pick any trading day to plan or review, including a day with no trades. The key is checked here only for shape and
// weekday (trading days run Monday to Friday); Rust validates it again and owns what day "now" is. The button uses
// the default control height so it lines up with the 36 px date field (P0-D10).
import { type FormEvent, useId, useState } from "react";

import { Button, TextField } from "../../../design-system";
import { isTradingDayKey } from "../view-models/daily-review";

export function DayChooser({ initial, label = "Review a day", onChoose }: {
  initial: string; label?: string; onChoose: (day: string) => void;
}) {
  const id = useId().replace(/:/g, "");
  const [day, setDay] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isTradingDayKey(day)) {
      setError(/^\d{4}-\d{2}-\d{2}$/.test(day) ? "Choose a weekday: a weekend counts toward Monday's trading day" : "Enter a date");
      return;
    }
    setError(undefined);
    onChoose(day);
  };
  return (
    <form className="dr-chooser" onSubmit={submit} aria-label={label}>
      <TextField id={`${id}-day`} label={label} hideLabel type="date" value={day} onChange={e => { setDay(e.target.value); setError(undefined); }} error={error} />
      <Button type="submit">{label === "Go to day" ? "Go" : "Open"}</Button>
    </form>
  );
}
