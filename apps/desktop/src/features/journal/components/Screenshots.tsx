// Trade screenshots (Build 20): pick, drop or paste PNG, JPEG or WebP images. The webview reads the bytes and Rust
// checks the real file type, size and dimensions, stores the file under the app's data folder with an opaque key
// and records its hash. Uploads are separate from the review's text, so a failed upload never loses notes. A missing
// or changed file shows as such; the rest of the review still reads.
import { SCREENSHOT_MAX_BYTES, SCREENSHOTS_PER_TRADE, type AttachmentMeta, type TradeReview } from "@fundedflow/domain";
import { ImageOff, Trash2 } from "lucide-react";
import { type ClipboardEvent, useState } from "react";

import { Button, ConfirmDialog, Dialog, FileDropzone, formatFileSize, formatInstant, IconButton, InlineNotice, Skeleton, StatList, useToast } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useAddScreenshot, useRemoveScreenshot, useScreenshot, useTradeReview } from "../../reviews/hooks/reviews";
import { UncertainOutcomeReview, type UncertainWrite } from "../../shared/UncertainOutcomeReview";
import type { TradeViewModel } from "../../trades/view-models/trade";

const ACCEPT = "image/png,image/jpeg,image/webp";

/** The file's bytes as base64, without a data-URL prefix. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : "");
    };
    reader.readAsDataURL(file);
  });
}

/** Early, advisory checks; Rust checks the bytes themselves. */
export function precheck(file: File): string | null {
  if (file.size === 0) return "The file is empty.";
  if (file.size > SCREENSHOT_MAX_BYTES) return `It is ${formatFileSize(file.size)}; screenshots can be at most 10 MB.`;
  if (file.type && !ACCEPT.split(",").includes(file.type)) return "Only PNG, JPEG and WebP images can be attached.";
  return null;
}

/**
 * P0-03: what an uncertain screenshot upload or removal is checked against: the trade's screenshots as stored now
 * (names, sizes and when each was attached; never a file location). Adding and removing share one lock per trade.
 */
function ScreenshotWriteReview({ write, account, trade }: { write: UncertainWrite; account: AccountViewModel; trade: TradeViewModel }) {
  const review = useTradeReview(account.id, trade.id);
  const stored = review.data?.attachments ?? [];
  return (
    <UncertainOutcomeReview write={write} what="this trade's screenshots" reviewReady={review.data !== undefined && !review.error} readReviewed={review.refresh}>
      {stored.length
        ? <StatList label="Screenshots saved on this trade" items={stored.map((a, i) => ({
          label: `${i + 1}. ${a.fileName ?? "Screenshot"}`,
          value: `${formatFileSize(a.byteSize)} · attached ${formatInstant(a.createdAt, { timeZone: account.timezone, year: true, zoneName: true })}`,
        }))} />
        : <p>No screenshot is saved on this trade.</p>}
    </UncertainOutcomeReview>
  );
}

export function Screenshots({ account, trade, review }: { account: AccountViewModel; trade: TradeViewModel; review: TradeReview | null }) {
  const add = useAddScreenshot(account.id, trade.id);
  const toast = useToast();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const attachments = review?.attachments ?? [];
  const readOnly = account.archivedAt !== null;
  const room = SCREENSHOTS_PER_TRADE - attachments.length;

  const upload = async (files: File[]) => {
    // Paste reaches here even while the dropzone is disabled; a locked scope sends nothing.
    if (readOnly || busy || !add.canSubmit) return;
    const found: string[] = [];
    if (files.length > room) found.push(`Only ${Math.max(room, 0)} more ${room === 1 ? "screenshot fits" : "screenshots fit"} on this trade (${SCREENSHOTS_PER_TRADE} at most).`);
    setBusy(true);
    let saved = 0;
    for (const file of files.slice(0, Math.max(room, 0))) {
      const name = file.name || "Pasted image";
      const early = precheck(file);
      if (early) { found.push(`${name}: ${early}`); continue; }
      try {
        const data = await readAsBase64(file);
        await add.submit({ accountId: account.id, tradeId: trade.id, fileName: file.name || null, dataBase64: data });
        saved++;
      } catch (error) {
        const issue = (error as { issues?: { message: string }[]; category?: string }) ?? {};
        const why = issue.issues?.[0]?.message ?? (issue.category === "conflict" ? "it is already attached to this trade."
          : issue.category === "uncertain-outcome" ? "no answer came back, so it may have been attached. Check below; nothing is sent again."
          : "it couldn't be saved.");
        found.push(`${name}: ${why.charAt(0).toUpperCase()}${why.slice(1)}`);
        if (issue.category === "uncertain-outcome") break;
      }
    }
    setBusy(false);
    setProblems(found);
    if (saved) toast.show({ tone: "success", title: saved === 1 ? "Screenshot attached" : `${saved} screenshots attached` });
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); void upload(files); }
  };

  return (
    <section className="jr-shots" aria-labelledby="jr-shots-title" onPaste={onPaste}>
      <h4 id="jr-shots-title">Screenshots <span className="ds-faint">({attachments.length} of {SCREENSHOTS_PER_TRADE})</span></h4>
      {attachments.length > 0 && (
        <ul className="jr-shot-grid">
          {attachments.map(a => <Thumb key={a.id} account={account} trade={trade} attachment={a} readOnly={readOnly} />)}
        </ul>
      )}
      {problems.length > 0 && (
        <InlineNotice tone="warning" title="Some images weren't attached" onDismiss={() => setProblems([])} live="polite">
          <ul>{problems.map(p => <li key={p}>{p}</li>)}</ul>
          <p>Your review's notes are not affected.</p>
        </InlineNotice>
      )}
      {add.outcome === "uncertain-outcome" && <ScreenshotWriteReview write={add} account={account} trade={trade} />}
      {!readOnly && room > 0 && (
        <div tabIndex={0} className="jr-paste" aria-label="Screenshot area: drop, browse, or paste an image with Ctrl+V">
          <FileDropzone label="Add screenshots" multiple accept={ACCEPT} disabled={busy || !add.canSubmit} onFiles={files => void upload(files)}
            hint={busy ? "Saving…" : "PNG, JPEG or WebP up to 10 MB each. Drop, browse, or click here and paste (Ctrl+V). Stored on this computer only."} />
        </div>
      )}
    </section>
  );
}

function Thumb({ account, trade, attachment, readOnly }: { account: AccountViewModel; trade: TradeViewModel; attachment: AttachmentMeta; readOnly: boolean }) {
  const image = useScreenshot(account.id, attachment.id);
  const remove = useRemoveScreenshot(account.id, trade.id);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [undecodable, setUndecodable] = useState(false);
  const name = attachment.fileName ?? "Screenshot";
  const data = image.data;
  const src = data?.status === "ok" && data.dataBase64 && !undecodable ? `data:${data.mimeType};base64,${data.dataBase64}` : null;
  const problem = attachment.fileStatus === "missing" || data?.status === "missing" ? "The image file is missing from this computer's data folder."
    : attachment.fileStatus === "changed" || data?.status === "corrupt" ? "The image file has changed since it was attached and can't be shown safely."
    : image.error ? "The image couldn't be read."
    : undecodable ? "The file is stored but this computer can't display it." : null;
  const dims = attachment.width && attachment.height ? `${attachment.width} × ${attachment.height}` : null;
  return (
    <li className="jr-shot">
      {src ? (
        <button type="button" className="jr-shot-open" onClick={() => setOpen(true)} aria-label={`View ${name} larger`}>
          <img src={src} alt={`Screenshot ${name}`} loading="lazy" onError={() => setUndecodable(true)} />
        </button>
      ) : problem ? (
        <div className="jr-shot-missing" role="img" aria-label={`${name}: ${problem}`}>
          <ImageOff size={20} aria-hidden="true" /><span>{problem}</span>
        </div>
      ) : (
        <Skeleton shape="block" height={96} />
      )}
      <div className="jr-shot-meta">
        <span className="jr-shot-name" title={name}>{name}</span>
        <span className="ds-faint">{[dims, formatFileSize(attachment.byteSize)].filter(Boolean).join(" · ")}</span>
        {!readOnly && <IconButton size="sm" variant="ghost" label={`Remove ${name}`} icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setConfirm(true)} />}
      </div>
      {src && (
        <Dialog open={open} onOpenChange={setOpen} title={name} size="lg" footer={<Button onClick={() => setOpen(false)}>Close</Button>}>
          <img className="jr-shot-full" src={src} alt={`Screenshot ${name}, full size`} />
        </Dialog>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Remove this screenshot?" confirmLabel="Remove" busyLabel="Removing…"
        describeError={e => (e as { category?: string })?.category === "uncertain-outcome"
          ? "No answer came back, so it may have been removed. Close this and check the trade's screenshots; nothing is sent again."
          : "It didn't finish. Check whether anything changed before trying again."}
        onConfirm={async () => { await remove.submit(attachment.id); setConfirm(false); }}>
        <p>{name} is taken off this trade. The review's notes are not changed.</p>
      </ConfirmDialog>
    </li>
  );
}
