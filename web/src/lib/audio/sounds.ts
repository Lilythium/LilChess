export const sounds = {
  move: "/sounds/move.wav",
  capture: "/sounds/capture.wav",
  check: "/sounds/check.wav",
  castle: "/sounds/castle.wav",
  gameStart: "/sounds/game_start.wav",
  gameEnd: "/sounds/game_end.wav",
} as const;

export type SoundName = keyof typeof sounds;