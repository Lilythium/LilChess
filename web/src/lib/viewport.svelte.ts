
// Phones: narrow screens, and short landscape screens (a phone on its side).
const MOBILE = "(max-width: 800px), (orientation: landscape) and (max-height: 500px)";
// A phone on its side: the board takes the full height and the controls sit beside it.
const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";
// The bottom tab bar needs vertical room, so short landscape screens keep the header menu instead.
const BOTTOM_NAV = "(max-width: 800px) and (min-height: 501px)";

function create() {
  const state = $state({ mobile: false, touch: false, shortLandscape: false, bottomNav: false });
  if (typeof matchMedia === "undefined") return state;
  const queries = {
    mobile: matchMedia(MOBILE),
    touch: matchMedia("(pointer: coarse)"),
    shortLandscape: matchMedia(SHORT_LANDSCAPE),
    bottomNav: matchMedia(BOTTOM_NAV),
  };
  const sync = () => {
    state.mobile = queries.mobile.matches;
    state.touch = queries.touch.matches;
    state.shortLandscape = queries.shortLandscape.matches;
    state.bottomNav = queries.bottomNav.matches;
  };
  sync();
  for (const query of Object.values(queries)) query.addEventListener("change", sync);
  return state;
}

export const viewport = create();
