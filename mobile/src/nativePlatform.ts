import { Clipboard } from "@capacitor/clipboard";
import { Share } from "@capacitor/share";

export interface NativeShareRequest {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * The system share sheet. WebView `navigator.share` is unreliable on iOS's capacitor:// scheme and absent in some
 * Android WebViews, so the app uses the plugin. Dismissing the sheet is not an error.
 */
export async function nativeShare(request: NativeShareRequest): Promise<void> {
  try {
    await Share.share({ title: request.title, text: request.text, url: request.url, dialogTitle: request.title });
  } catch (error) {
    if (isShareDismissed(error)) return;
    throw error;
  }
}

/** Native clipboard. `navigator.clipboard` needs a secure context and a user gesture in the iOS WebView. */
export async function nativeCopy(text: string): Promise<void> {
  await Clipboard.write({ string: text });
}

export function isShareDismissed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /cancel|dismiss/i.test(message);
}
