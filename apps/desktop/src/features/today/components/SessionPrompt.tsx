// P0-D27: an optional, contextual entry to the existing daily review for the selected account's current trading day.
// Before any trade on that day it offers the before-session plan; once Rust attributes a trade to the day, the
// after-session review. Both open the one Daily review page (Build 22) for that account and day; nothing is edited
// here. "Skip for now" hides the stage for this account and day only and is not completion; a compact action brings
// it back. Loading and unreadable days never show a prompt, so "no trades" is never guessed.
import { ClipboardCheck, NotebookPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Button, formatTradingDay, StatusIndicator, useToast } from "../../../design-system";
import { accountLabel } from "../../accounts/components/presentation";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useDailyReviewDay, useDailyReviewIndex } from "../../daily-reviews/hooks/daily-reviews";
import { dailyReviewPath } from "../../daily-reviews/view-models/daily-review";
import { useSetSetting, useSetting } from "../../settings/hooks/settings";
import {
  addSessionSkip, readSessionSkips, removeSessionSkip, SESSION_SKIPS_SETTING, sessionPromptState, type SessionSkip, type SessionStage,
} from "../view-models/session-prompt";

const STAGE_TITLE: Record<SessionStage, string> = { plan: "Before-session plan", review: "After-session review" };

/** Saved skips; a change applies at once and holds for this visit even if it can't be saved. */
function useSessionSkips() {
  const saved = useSetting(SESSION_SKIPS_SETTING);
  const save = useSetSetting(SESSION_SKIPS_SETTING);
  const toast = useToast();
  const [local, setLocal] = useState<SessionSkip[] | null>(null);
  const skips = local ?? readSessionSkips(saved.data?.value);
  const update = (next: SessionSkip[]) => {
    setLocal(next);
    save.submit(next).catch(() => toast.show({ tone: "error", title: "That choice wasn't saved", description: "It applies until you close FundedFlow." }));
  };
  return {
    // A failed read counts as no skips: the prompt shows rather than staying hidden.
    ready: local !== null || saved.data !== undefined || saved.error !== null,
    skips,
    skip: (s: SessionSkip) => update(addSessionSkip(skips, s)),
    unskip: (s: SessionSkip) => update(removeSessionSkip(skips, s)),
  };
}

export function SessionPrompt({ account, checkedAt }: { account: AccountViewModel; checkedAt: string }) {
  const navigate = useNavigate();
  const index = useDailyReviewIndex(account.id);
  const tradingDay = index.data?.accountId === account.id ? index.data.currentTradingDay : null;
  const day = useDailyReviewDay(account.id, tradingDay);
  const skips = useSessionSkips();
  // Each check (Check again, or coming back to the app) re-reads the current trading day, so a new day gets its own
  // prompt. Trade writes and imports already refresh the day through the daily-review query keys.
  const firstCheck = useRef(checkedAt);
  const refreshIndex = index.refresh;
  useEffect(() => {
    if (checkedAt !== firstCheck.current) refreshIndex().catch(() => { /* The day's state shows the failure. */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAt]);

  const state = index.data === undefined && index.error
    ? { kind: "unavailable" as const }
    : skips.ready ? sessionPromptState(account.id, tradingDay, day, skips.skips) : { kind: "loading" as const };

  if (state.kind === "loading") {
    return (
      <section className="ds-card td-session is-compact" aria-label="Session plan / review" aria-busy="true">
        <p className="ds-faint td-session-line" role="status">Checking today's trading day…</p>
      </section>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <section className="ds-card td-session is-compact" aria-label="Session plan / review">
        <StatusIndicator status="unknown" label="Session plan / review unavailable" variant="inline"
          detail="The trading day couldn't be read, so Today can't tell whether this account has traded yet. Check again to retry." />
      </section>
    );
  }

  const { stage, plan, review, trades } = state;
  const skip: SessionSkip = { accountId: account.id, tradingDay: state.tradingDay, stage };
  const scope = `${accountLabel(account)} · trading day ${formatTradingDay(state.tradingDay)}`;
  const open = () => navigate(dailyReviewPath(account.id, state.tradingDay));

  if (state.skipped && review !== "completed") {
    return (
      <section className="ds-card td-session is-compact" aria-label="Session plan / review">
        <p className="ds-faint td-session-line">{STAGE_TITLE[stage]} skipped for {scope}.</p>
        <Button size="sm" variant="ghost" onClick={() => skips.unskip(skip)}>Session plan / review</Button>
      </section>
    );
  }

  const done = review === "completed";
  const title = done ? "Daily review" : STAGE_TITLE[stage];
  const tradesText = `${trades} trade${trades === 1 ? "" : "s"} recorded for this trading day.`;
  let badge: { tone: "flow" | "profit" | "warn"; text: string } | null = null;
  let body: string;
  let primary: string;
  if (done) {
    badge = { tone: "profit", text: "Completed" };
    body = "This trading day's review is completed. You can open it to read or change it.";
    primary = "Open completed review";
  } else if (stage === "plan") {
    badge = plan === "saved" ? { tone: "flow", text: "Plan saved" } : null;
    body = plan === "saved"
      ? "No trades are recorded for this trading day yet. Your plan is saved in the daily review."
      : "No trades are recorded for this trading day yet. Write your focus, setups and limits before you trade.";
    primary = plan === "saved" ? "View or edit plan" : "Start plan";
  } else {
    badge = review === "started" ? { tone: "warn", text: "Draft" } : null;
    body = `${tradesText} Review the session when you're ready; this doesn't end the session or complete the review.`;
    primary = review === "started" ? "Continue after-session review" : "Start after-session review";
  }
  const Icon = stage === "plan" && !done ? NotebookPen : ClipboardCheck;

  return (
    <section className="ds-card td-session" aria-labelledby="td-session-title">
      <div className="td-session-text">
        <div className="td-session-head">
          <Icon size={18} aria-hidden="true" />
          <h2 id="td-session-title" className="ds-title">{title}</h2>
          {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
        </div>
        <p className="ds-faint td-session-line">{scope}</p>
        <p className="td-session-line">{body}</p>
      </div>
      <div className="td-session-actions">
        <Button size="sm" variant="primary" onClick={open}>{primary}</Button>
        {!done && stage === "review" && plan === "saved" && <Button size="sm" onClick={open}>View plan</Button>}
        {!done && <Button size="sm" variant="ghost" onClick={() => skips.skip(skip)}>Skip for now</Button>}
      </div>
    </section>
  );
}
