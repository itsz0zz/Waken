// Any web page can open a waken:// link. Some screens act as soon as they open (power a PC on, start a game,
// which closes the running one), and a list of forbidden paths can always be bypassed: every link opens home.
export function redirectSystemPath(_: { path: string; initial: boolean }): string {
  return '/';
}
