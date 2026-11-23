// Any web page can open a waken:// link. Screens that act as soon as they open (power the PC on, start a game,
// which closes the running one) must only be reached by a tap inside the app: send those links home.
const ACTING_SCREENS = /(^|\/)(wake|stream)(\/|\?|#|$)/i;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return ACTING_SCREENS.test(decodeURIComponent(path)) ? '/' : path;
  } catch {
    return '/'; // malformed escape sequence
  }
}
