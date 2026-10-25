/** A full page navigation (the server decides the destination with fresh cookies). Its own module so tests can stub it. */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
