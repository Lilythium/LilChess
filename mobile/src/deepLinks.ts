import { App } from "@capacitor/app";
import { parseInviteLink, type InviteLink } from "./inviteLink.js";

/**
 * The invite link that launched the app (cold start from `lilchess://invite?...`), if any. Links that do not parse
 * as a LilChess invite are ignored: the OS hands over whatever URL matched the registered scheme.
 */
export async function readLaunchInvite(): Promise<InviteLink | null> {
  const launch = await App.getLaunchUrl();
  return launch?.url ? parseInviteLink(launch.url) : null;
}

/**
 * Invite links opened while the app is already running (or resumed by one). Returns an unsubscribe function.
 * The callback only ever receives a parsed link; it is still the caller's job to confirm the server and let the
 * server validate the invite.
 */
export async function listenForInviteLinks(onInvite: (link: InviteLink) => void): Promise<() => void> {
  const handle = await App.addListener("appUrlOpen", ({ url }) => {
    const link = parseInviteLink(url);
    if (link) onInvite(link);
  });
  return () => {
    void handle.remove();
  };
}
