import type {
  Color, GameResult, HostColor, SimulInviteStatus, SimulScore, SimulStatus, Termination, Variant,
} from "@lilchess/shared";

export interface SimulSummary {
  id: string; name: string; status: SimulStatus; mode: "live" | "correspondence"; variant: Variant;
  hostId: number; hostName: string; initialMs: number | null; incrementMs: number | null;
  daysPerMove: number | null; maxPlayers: number; createdAt: number;
  accepted: number; boardsLeft: number; boardsToMove: number;
  viewerGameId: string | null; myStatus: SimulInviteStatus | null;
}

export interface SimulLists {
  hosting: SimulSummary | null;
  invitations: SimulSummary[];
  running: SimulSummary[];
  recent: SimulSummary[];
}

export interface SimulBoard {
  seat: number; userId: number; username: string; gameId: string; hostColor: Color; turn: Color;
  status: "started" | "finished" | "aborted"; result: GameResult | null; termination: Termination | null;
  ply: number; fen: string; lastMove: string | null; whiteMs: number; blackMs: number;
  deadlineAt: number; drawOfferedBy: Color | null;
}

export interface SimulDetail {
  simul: {
    id: string; name: string; status: SimulStatus; mode: "live" | "correspondence"; variant: Variant;
    hostId: number; hostName: string; initialMs: number | null; incrementMs: number | null;
    daysPerMove: number | null; hostExtraMs: number; hostColor: HostColor; maxPlayers: number;
    createdAt: number; startedAt: number | null; endedAt: number | null;
  };
  players: { userId: number; username: string; status: SimulInviteStatus; seat: number | null; gameId: string | null }[];
  boards: SimulBoard[];
  score: SimulScore;
  viewer: { isHost: boolean; invite: SimulInviteStatus | null; gameId: string | null };
  serverNow: number;
}