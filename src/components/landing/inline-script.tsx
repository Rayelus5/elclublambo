/**
 * An inline script that runs while the browser parses the server HTML, and is an inert data block when React renders it
 * on the client (a client navigation into a layout that holds it). React never runs scripts it creates, and in
 * development it logs «Encountered a script tag…» for an executable one; `text/plain` is a data block, so it does not.
 * Pattern from the Next docs, «Preventing flash before hydration» → «Extracting a reusable component».
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
