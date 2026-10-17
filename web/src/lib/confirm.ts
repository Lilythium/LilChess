// In-app replacement for window.confirm(). The browser dialog works in the Capacitor WebView but is titled with the
// WebView's internal host ("localhost"), blocks the JS thread, and can't be styled for touch. ConfirmDialog.svelte
// renders the request; callers just `await askConfirm("...")`.

export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export interface ConfirmOptions { confirmLabel?: string; cancelLabel?: string; danger?: boolean }

type Listener = (request: ConfirmRequest | null) => void;

let current: { request: ConfirmRequest; resolve: (answer: boolean) => void } | null = null;
let listener: Listener | null = null;

/** ConfirmDialog subscribes here. Returns an unsubscribe function. */
export function subscribeConfirm(next: Listener): () => void {
  listener = next;
  next(current?.request ?? null);
  return () => { if (listener === next) listener = null; };
}

/** Ask the user to confirm. Resolves true on confirm, false on cancel/dismiss. A newer request cancels an older one. */
export function askConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  answerConfirm(false);
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = {
      message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      danger: options.danger ?? false,
    };
    current = { request, resolve };
    listener?.(request);
  });
}

/** Called by the dialog (or by a newer request) to settle the pending question. */
export function answerConfirm(answer: boolean): void {
  const pending = current;
  if (!pending) return;
  current = null;
  listener?.(null);
  pending.resolve(answer);
}
