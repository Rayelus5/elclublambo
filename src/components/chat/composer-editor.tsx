"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, mergeAttributes, ReactRenderer, useEditor, type Editor } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { searchMentionTargetsAction } from "@/lib/chat/actions";
import {
  composerKeyAction,
  filterSlashCommands,
  loadMentionItems,
  type MentionItem,
  type SlashCommand,
} from "@/lib/chat/mentions";
import { cn } from "@/lib/utils";

// --- suggestion popup ------------------------------------------------------------------------------

interface ListEntry {
  key: string;
  label: string;
  hint?: string;
}

interface SuggestionListHandle {
  onKeyDown(e: SuggestionKeyDownProps): boolean;
}

interface SuggestionListProps {
  entries: ListEntry[];
  label: string;
  onPick(index: number): void;
}

const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(function SuggestionList(
  { entries, label, onPick },
  ref,
) {
  const [selected, setSelected] = useState(0);
  const [prevEntries, setPrevEntries] = useState(entries);
  if (prevEntries !== entries) {
    // New results: restart at the first option.
    setPrevEntries(entries);
    setSelected(0);
  }

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown({ event }) {
        if (entries.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % entries.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s - 1 + entries.length) % entries.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          onPick(selected);
          return true;
        }
        return false;
      },
    }),
    [entries, onPick, selected],
  );

  if (entries.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label={label}
      className="w-72 max-w-[calc(100vw-2rem)] rounded-panel border border-border-strong bg-surface p-1"
    >
      {entries.map((entry, i) => (
        <button
          key={entry.key}
          type="button"
          role="option"
          aria-selected={i === selected}
          // keep the editor focused while picking with the pointer
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-3 text-left text-sm text-fg outline-none",
            i === selected ? "bg-surface-2 ring-2 ring-accent ring-inset" : "hover:bg-surface-2",
          )}
        >
          <span className="truncate">{entry.label}</span>
          {entry.hint ? <span className="shrink-0 truncate text-[13px] text-fg-muted">{entry.hint}</span> : null}
        </button>
      ))}
    </div>
  );
});

type OpenKind = "mention" | "slash";
type OpenState = Record<OpenKind, boolean>;

function createRender<T>(
  kind: OpenKind,
  open: OpenState,
  label: string,
  toEntry: (item: T, index: number) => ListEntry,
) {
  return () => {
    let renderer: ReactRenderer<SuggestionListHandle> | null = null;

    const place = (props: SuggestionProps<T, T>) => {
      const rect = props.clientRect?.();
      const el = renderer?.element;
      if (!rect || !el) return;
      // Opens upwards: the composer lives at the bottom of the viewport.
      el.style.position = "fixed";
      el.style.zIndex = "60";
      // Inside the expanded dialog Radix disables pointer events on everything outside its content.
      el.style.pointerEvents = "auto";
      el.dataset.suggestionPopup = "";
      el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 296))}px`;
      el.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
    };

    const propsFor = (props: SuggestionProps<T, T>) => ({
      entries: props.items.map(toEntry),
      label,
      onPick: (index: number) => {
        const item = props.items[index];
        if (item !== undefined) props.command(item);
      },
    });

    return {
      onStart(props: SuggestionProps<T, T>) {
        open[kind] = props.items.length > 0;
        renderer = new ReactRenderer(SuggestionList, { props: propsFor(props), editor: props.editor });
        document.body.appendChild(renderer.element);
        place(props);
      },
      onUpdate(props: SuggestionProps<T, T>) {
        open[kind] = props.items.length > 0;
        renderer?.updateProps(propsFor(props));
        place(props);
      },
      onKeyDown(props: SuggestionKeyDownProps) {
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit() {
        open[kind] = false;
        renderer?.element.remove();
        renderer?.destroy();
        renderer = null;
      },
    };
  };
}

// --- extensions ------------------------------------------------------------------------------------

export interface EditorHandlers {
  expanded: boolean;
  canAttach: boolean;
  canMentionEveryone: boolean;
  onAlpha?: () => void;
  onPickImage: () => void;
  onSubmit: () => void;
  onUpdate: (editor: Editor) => void;
}

type HandlersRef = () => EditorHandlers;

/** Holds the latest handlers; the (build-once) extensions read it lazily. */
class HandlerStore {
  constructor(public current: EditorHandlers) {}
  set(next: EditorHandlers) {
    this.current = next;
  }
}

const MentionWithKind = Mention.extend({
  addAttributes() {
    return {
      kind: {
        default: "member",
        parseHTML: (el) => el.getAttribute("data-kind"),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-label"),
        renderHTML: (attrs) => (attrs.label ? { "data-label": attrs.label } : {}),
      },
    };
  },
});

function buildExtensions(h: HandlersRef, open: OpenState, expanded: boolean) {
  const slash = Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          pluginKey: new PluginKey("slashCommands"),
          char: "/",
          allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
          items: ({ query }) => filterSlashCommands(query, { canAttach: h().canAttach, hasAlpha: !!h().onAlpha }),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            if (props.id === "codigo") editor.chain().focus().toggleCodeBlock().run();
            else if (props.id === "imagen") h().onPickImage();
            else if (props.id === "alpha") h().onAlpha?.();
          },
          render: createRender<SlashCommand>("slash", open, "Comandos", (c) => ({
            key: c.id,
            label: c.label,
            hint: c.description,
          })),
        }),
      ];
    },
  });

  const mention = MentionWithKind.configure({
    renderText: ({ node }) => `@${node.attrs.label ?? ""}`,
    renderHTML: ({ node, options }) => [
      "span",
      mergeAttributes({ "data-type": "mention" }, options.HTMLAttributes),
      `@${node.attrs.label ?? ""}`,
    ],
    suggestion: {
      char: "@",
      debounce: 150,
      items: ({ query }: { query: string }) =>
        loadMentionItems(query, {
          canMentionEveryone: h().canMentionEveryone,
          search: searchMentionTargetsAction,
        }),
      command: ({ editor, range, props: attrs }) => {
        const props = attrs as unknown as MentionItem;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: "mention", attrs: { kind: props.kind, id: props.id, label: props.label } },
            { type: "text", text: " " },
          ])
          .run();
      },
      render: createRender<MentionItem>("mention", open, "Menciones", (m, i) => ({
        key: `${m.kind}:${m.id ?? i}`,
        label: m.kind === "role" ? `@${m.label}` : m.kind === "everyone" ? "@everyone" : m.label,
        hint: m.hint,
      })),
    },
  });

  return [
    StarterKit.configure({
      heading: expanded ? { levels: [1, 2, 3] } : false,
      blockquote: expanded ? {} : false,
      horizontalRule: expanded ? {} : false,
      // The link and underline extensions bundled in StarterKit 3 are replaced by our own, stricter Link.
      link: false,
      underline: false,
    }),
    Link.configure({
      autolink: true,
      openOnClick: false,
      protocols: ["http", "https"],
      defaultProtocol: "https",
      isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:\/\//i.test(url),
    }),
    Placeholder.configure({
      placeholder: expanded ? "Escribe con formato. Usa / para comandos." : "Escribe un mensaje. Usa @ para mencionar y / para comandos.",
    }),
    mention,
    slash,
    ...(expanded ? [Table.configure({ resizable: false }), TableRow, TableHeader, TableCell] : []),
  ];
}

// --- hook ------------------------------------------------------------------------------------------

export function useChatEditor(opts: EditorHandlers & { editable: boolean; initialContent?: unknown }) {
  // The extension list is built once; it reads the latest handlers lazily through this getter.
  const [store] = useState(() => new HandlerStore(opts));
  useEffect(() => {
    store.set(opts);
  });
  const [open] = useState<OpenState>(() => ({ mention: false, slash: false }));
  const [extensions] = useState(() => buildExtensions(() => store.current, open, opts.expanded));

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: (opts.initialContent as object | undefined) ?? "",
    editable: opts.editable,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Mensaje",
        spellcheck: "true",
      },
      handleKeyDown: (view, event) => {
        const action = composerKeyAction(
          {
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.isComposing || view.composing,
          },
          { expanded: store.current.expanded, suggestionOpen: open.mention || open.slash },
        );
        if (action !== "send") return false;
        event.preventDefault();
        store.current.onSubmit();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => store.current.onUpdate(ed),
  });

  useEffect(() => {
    if (editor && editor.isEditable !== opts.editable) editor.setEditable(opts.editable);
  }, [editor, opts.editable]);

  return editor;
}
