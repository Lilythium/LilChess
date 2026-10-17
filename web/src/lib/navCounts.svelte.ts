// Badge counts shown by both the header menu and the phone tab bar. Header.svelte polls the server and
// writes here, so the tab bar never makes requests of its own.
export const navCounts = $state({ yourTurn: 0, simulInvites: 0 });
