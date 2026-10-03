// Remembers "this visitor opened invite <id> while logged out". App.svelte swaps layouts when
// auth changes, which remounts the invite page; module state survives that, so the page can
// auto-accept right after the visitor logs in, registers, or continues as a guest.
export const pendingInvite = $state<{ id: string | null }>({ id: null });