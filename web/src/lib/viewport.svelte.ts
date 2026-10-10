const MOBILE = "(max-width: 800px), (orientation: landscape) and (max-height: 500px)";

function create() {
  const state = $state({ mobile: false, touch: false });
  if (typeof matchMedia === "undefined") return state;
  const mobile = matchMedia(MOBILE);
  const touch = matchMedia("(pointer: coarse)");
  const sync = () => { state.mobile = mobile.matches; state.touch = touch.matches; };
  sync();
  mobile.addEventListener("change", sync);
  touch.addEventListener("change", sync);
  return state;
}

export const viewport = create();