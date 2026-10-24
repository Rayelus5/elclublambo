import { GiveawayCard } from "@/components/giveaways/giveaway-card";
import type { GiveawayCard as Card } from "@/lib/giveaways/types";

function Group({ id, title, items, empty }: { id: string; title: string; items: Card[]; empty: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2 id={`${id}-title`} className="text-h2">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map((g) => (
            <li key={g.id} className="min-w-0">
              <GiveawayCard giveaway={g} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** «Abiertos» (open, or closed and waiting for its drand round) and then «Terminados», in the order the RPC gives. */
export function GiveawayList({ items }: { items: Card[] }) {
  const live = items.filter((g) => g.status === "open" || g.status === "closed");
  const ended = items.filter((g) => g.status !== "open" && g.status !== "closed");
  return (
    <div className="flex flex-col gap-8">
      <Group id="abiertos" title="Abiertos" items={live} empty="No hay sorteos abiertos ahora." />
      <Group id="terminados" title="Terminados" items={ended} empty="Aún no ha terminado ningún sorteo." />
    </div>
  );
}
