"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Curated in-house set: ~120 common emoji. A full picker library (emoji-mart & co.) ships 400 KB+ of data for
// something this composer only needs as a quick insert, so we keep a small static grid, loaded lazily.
const CATEGORIES: { id: string; label: string; emoji: string[] }[] = [
  {
    id: "caras",
    label: "Caras",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘",
      "😋", "😎", "🤓", "🤔", "🤨", "😐", "🙄", "😏", "😴", "🤯", "😱", "😭", "😢", "😤", "😡", "🥳",
    ],
  },
  {
    id: "gestos",
    label: "Gestos",
    emoji: [
      "👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "👀", "🤞", "✌️", "🤘", "👌", "🫡", "🫶", "👋", "🤙",
    ],
  },
  {
    id: "simbolos",
    label: "Símbolos",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "🔥", "✨", "⭐", "💯", "✅", "❌", "⚠️",
      "❓", "❗", "🚀", "📈", "📉", "💎", "🪙", "💰",
    ],
  },
  {
    id: "objetos",
    label: "Objetos",
    emoji: [
      "🎉", "🎁", "🏆", "🎯", "💡", "🔒", "🔑", "🛠️", "⚙️", "📌", "📎", "🔔", "⏰", "💻", "📱", "🌐",
    ],
  },
  {
    id: "naturaleza",
    label: "Naturaleza",
    emoji: [
      "🐶", "🐱", "🦊", "🐻", "🐼", "🦁", "🐸", "🐵", "🦄", "🐢", "🌙", "☀️", "🌈", "🌊", "🍀", "🌱",
      "☕", "🍕", "🍔", "🍺",
    ],
  },
];

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [active, setActive] = useState(CATEGORIES[0]!.id);
  const category = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]!;
  return (
    <div className="w-72 max-w-[calc(100vw-2rem)] rounded-panel border border-border-strong bg-surface p-2">
      <div role="tablist" aria-label="Categorías de emoji" className="mb-2 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === active}
            onClick={() => setActive(c.id)}
            className={cn(
              "min-h-11 rounded-control px-2.5 text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent",
              c.id === active ? "bg-surface-2 text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={category.label} className="grid grid-cols-6 gap-1">
        {category.emoji.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`Insertar ${e}`}
            onClick={() => onPick(e)}
            className="flex size-11 items-center justify-center rounded-control text-xl outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
