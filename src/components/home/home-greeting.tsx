/**
 * Top of Inicio: the h1 stays «Inicio» (a small label: e2e and screen readers rely on it, P1-R16) and the greeting is
 * the display line under it. `name` comes from memberName; null when the member row could not be read.
 */
export function HomeGreeting({ name }: { name: string | null }) {
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <h1 className="font-mono text-small font-normal tracking-[0.12em] text-fg-muted uppercase">Inicio</h1>
      <p className="wide max-w-full font-display text-[clamp(2.25rem,8cqi,4.5rem)] leading-[0.95] font-black tracking-[-0.03em] break-words text-fg">
        {name ? `Buenas, ${name}` : "Buenas"}
      </p>
    </header>
  );
}
