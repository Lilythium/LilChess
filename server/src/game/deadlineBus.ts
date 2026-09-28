import { EventEmitter } from "node:events";

export const deadlineBus = new EventEmitter();

export function notifyDeadlineChanged(): void {
  deadlineBus.emit("changed");
}