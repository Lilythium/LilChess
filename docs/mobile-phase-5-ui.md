# Mobile Phase 5: mobile-first UI and navigation

Scope: web UI only (`web/`). No server, protocol, API-client or native-project changes, so this is independent of the
Phase 3/4 networking work. Everything here ships in the normal web build too; nothing is gated on Capacitor except the
`html.native` rules in `app.css`.

## What the web client already had (v2 Phase 7)

Hamburger header menu, `viewport.mobile`, a phone game layout (`.game-mobile`: player strips, board, move strip,
action bar), responsive tournament / simul / profile pages, and `e2e/overflow.e2e.ts` for horizontal overflow.
Phase 5 builds on that rather than replacing it.

## Changes

| Area | Change |
| --- | --- |
| Game page (phone) | `Game.svelte` never rendered the `.dock` wrapper that `app.css` pins to the bottom of the screen, so the actions scrolled away and a simul bar landed under the board in portrait. The strips, moves and dock now sit in explicit grid areas, as `LocalGame.svelte` already did. |
| Offers and warnings | Draw / takeback offers and the abort warning float just above the dock instead of pushing the layout, so an incoming offer cannot move the board under a finger. Buttons are touch-sized. |
| Move history | `MoveStrip` gets an "All moves" button that opens the full list in a bottom sheet (`MoveSheet`, built on the new `BottomSheet`). Board space is never given up for it. |
| Landscape phones | The board takes the full height; the column beside it holds the opponent strip, an inline move list, your strip and the action dock. Side safe-area insets are respected (they were zeroed on the game page before). |
| Navigation | New `BottomNav` tab bar (Play, My games, Watch, Events, More) on portrait phones and small tablets. "More" is a bottom sheet with the remaining header links. Hidden on the game, local game and analysis pages (they have their own bottom controls) and in short landscape, which keeps the header menu. The header keeps only the logo while the tab bar is showing. Badge counts are shared through `navCounts.svelte.ts`, so the tab bar makes no requests of its own. |
| Confirmations | `askConfirm()` + `ConfirmDialog` replace `window.confirm()` for guest logout, cancelling a simul, resetting a simul link and deleting an imported game. The browser dialog is titled with the WebView's internal host in the native app. Admin-page confirmations still use `confirm()` (desktop tooling; it works in the WebView). |
| Promotion dialog | Escape cancels, dialog semantics added, choices are at least 44px. |
| Lobby | Challenge tables became a list whose rows wrap on narrow screens (buttons drop under the text instead of squeezing four columns). |
| WebView behaviour | Tap highlight off everywhere. In the native app (`html.native`): no overscroll bounce, no long-press callout, no text selection outside inputs. |
| Keyboard | `lib/keyboard.ts` marks `<html>` with `kb-open` / `--kb-inset` while a text field has focus and the viewport shrank, hides the tab bar meanwhile, and scrolls the focused field into view. The server-select screen no longer clips its card when the keyboard leaves little room. |

## Not changed on purpose

- Chessground configuration and board CSS (touch, drag, promotion and orientation behaviour are untouched).
- Android `windowSoftInputMode`, the iOS keyboard resize mode and the Capacitor Keyboard plugin: Phase 7 (platform integration).
- `SimulDetail` builds invite links from `location.origin`, which is the WebView's own origin in the native app. Phase 6 (invite links) must build them from the configured server URL.

## Verification

Automated (run in CI): `npm run check -w web`, `npm run lint`, `npm test` (new: `keyboard`, `confirm`, `navTabs`).

Playwright (`web/e2e/mobile-ui.e2e.ts`, needs `npm run dev`; not part of CI): tab bar, More sheet, game dock on screen,
move sheet, landscape layout.

Manual, on real devices or the browser's device emulation. Phase 5 is only done when these pass:

| Check | 320x568 | 390x844 | 768x1024 | 844x390 landscape |
| --- | --- | --- | --- | --- |
| Lobby: create a game, accept a challenge (buttons reachable, no sideways scroll) | | | | |
| Game: all of board, both clocks and Resign visible without scrolling | | | | |
| Game: draw offer arrives, Accept / Decline usable, board does not move | | | | |
| Game: drag and tap-tap moves, promotion picker, board flips for black | | | | |
| Game: open the move sheet, jump to a move, close with the backdrop | | | | |
| Profile, My games, Tournaments (host form), Simuls pages scroll and fit | | | | |
| Tab bar: badges, More sheet, tab bar hidden in a game and while typing | | | | |
| Notch / home indicator: nothing under them in portrait and landscape | | | | |
| Native only: no pull-to-refresh bounce, no grey tap flash, no long-press menu | | | | |
