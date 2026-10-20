// Confirmation before a destructive action. Nothing happens until the
// destructive button is chosen; Cancel, Escape and clicking outside close the
// dialog without acting. If the action fails the dialog stays open with the
// error, so the user knows nothing was deleted.

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useState } from "react";

import { DataError } from "../lib/data/api";

function errorText(e: unknown) {
  return e instanceof DataError || e instanceof Error ? e.message : String(e);
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** What will be affected, so the user can tell which record this is. */
  children: ReactNode;
  confirmLabel: string;
  /** Performs the action; a rejection keeps the dialog open and shows the error. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (busy) return;
    setError("");
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ff-dialog-overlay" />
        <Dialog.Content className="ff-dialog" role="alertdialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div>{children}</div>
          </Dialog.Description>
          {error && (
            <div role="alert" className="ff-error">
              {error} Nothing was deleted.
            </div>
          )}
          <div className="ff-row ff-dialog-actions">
            <Dialog.Close asChild>
              <button type="button" disabled={busy} autoFocus>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" className="ff-danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Deleting…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
