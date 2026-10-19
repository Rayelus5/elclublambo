import { RaffleCard } from "@/components/treasury/raffles/raffle-card";
import type { RaffleCard as Card } from "@/lib/treasury/raffles";

/** Open and closed raffles first (Activos), then the rest (Pasados), in the order the database gave them. */
export function RaffleList({ raffles, unlockedShares }: { raffles: Card[]; unlockedShares?: bigint }) {
  if (raffles.length === 0) return <p className="text-sm text-fg-muted">No hay sorteos todavía.</p>;
  const active = raffles.filter((r) => r.status === "open" || r.status === "closed");
  const past = raffles.filter((r) => r.status !== "open" && r.status !== "closed");
  const groups = [
    { title: "Activos", empty: "No hay sorteos activos.", items: active },
    { title: "Pasados", empty: "", items: past },
  ];
  return (
    <div className="flex flex-col gap-6">
      {groups
        .filter((g) => g.items.length > 0 || g.title === "Activos")
        .map((g) => (
          <div key={g.title} className="flex flex-col gap-3">
            <h3 className="text-base font-bold">{g.title}</h3>
            {g.items.length === 0 ? <p className="text-sm text-fg-muted">{g.empty}</p> : null}
            <div className="grid gap-4 lg:grid-cols-2">
              {g.items.map((r) => (
                <RaffleCard key={r.id} raffle={r} unlockedShares={unlockedShares} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
