export function RightRail() {
  return (
    <aside
      aria-label="Panel lateral"
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] border-l border-border bg-surface p-6 lg:block"
    >
      <section className="border border-border bg-bg p-4 rounded-panel">
        <h2 className="text-sm font-bold text-fg">Próximamente</h2>
        <p className="mt-2 text-[13px] text-fg-muted">
          Aquí vivirán la actividad y las novedades del club.
        </p>
      </section>
    </aside>
  );
}
