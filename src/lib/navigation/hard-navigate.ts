/** A full page navigation (the server decides the destination with fresh cookies). Its own module so tests can stub it. */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}

/** A full reload of the current URL (the proxy decides again with fresh cookies; never router.refresh). */
export function hardReload(): void {
  window.location.reload();
}
