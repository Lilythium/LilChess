import { NativeApiError, nativeRequest } from "./nativeApi.js";
import type { InviteTarget } from "./inviteLink.js";

export interface ChallengeInvitePreview {
  kind: "challenge";
  id: string;
  from_name: string;
  mode: "live" | "correspondence";
  initial_ms: number | null;
  increment_ms: number | null;
  days_per_move: number | null;
  color_pref: string | null;
  /** Aimed at one specific player: guests cannot accept it. */
  targeted: boolean;
  /** The server's own answer on whether this invite may be accepted as a guest. */
  guestsAllowed: boolean;
}

export interface SimulInvitePreview {
  kind: "simul";
  name: string;
  hostName: string;
  status: string;
  mode: "live" | "correspondence";
  maxPlayers: number;
  accepted: number;
}

export type InvitePreview = ChallengeInvitePreview | SimulInvitePreview;

/**
 * Looks an invite up on the server, without credentials: both endpoints are public so a logged-out visitor can see
 * what they are being invited to. The server decides whether the invite exists, has expired, and whether a guest
 * may accept it. Nothing about the link is trusted until this succeeds.
 */
export async function fetchInvitePreview(serverUrl: string, target: InviteTarget): Promise<InvitePreview> {
  if (target.kind === "challenge") {
    const body = await nativeRequest<unknown>(serverUrl, `/invites/${target.id}`);
    const response = isRecord(body) && body.ok === true ? body : null;
    const invite = response && isRecord(response.invite) ? response.invite : null;
    if (!response || !invite || typeof invite.from_name !== "string" || (invite.mode !== "live" && invite.mode !== "correspondence")) {
      throw new NativeApiError(502, "The server returned an invalid invite response.");
    }
    return {
      kind: "challenge",
      id: target.id,
      from_name: invite.from_name,
      mode: invite.mode,
      initial_ms: numberOrNull(invite.initial_ms),
      increment_ms: numberOrNull(invite.increment_ms),
      days_per_move: numberOrNull(invite.days_per_move),
      color_pref: typeof invite.color_pref === "string" ? invite.color_pref : null,
      targeted: Boolean(invite.targeted),
      guestsAllowed: response.guestsAllowed === true,
    };
  }

  const body = await nativeRequest<unknown>(serverUrl, `/simul-invites/${target.code}`);
  const invite = isRecord(body) && isRecord(body.invite) ? body.invite : null;
  if (
    !invite || typeof invite.hostName !== "string" || typeof invite.name !== "string" ||
    (invite.mode !== "live" && invite.mode !== "correspondence")
  ) {
    throw new NativeApiError(502, "The server returned an invalid simul invite response.");
  }
  return {
    kind: "simul",
    name: invite.name,
    hostName: invite.hostName,
    status: typeof invite.status === "string" ? invite.status : "open",
    mode: invite.mode,
    maxPlayers: numberOrNull(invite.maxPlayers) ?? 0,
    accepted: numberOrNull(invite.accepted) ?? 0,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
