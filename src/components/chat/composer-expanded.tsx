"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Send,
  Strikethrough,
  Table2,
} from "lucide-react";
import { EmojiButton } from "@/components/chat/emoji-button";
import { useChatEditor } from "@/components/chat/composer-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { docToPlainText } from "@/lib/chat/content";
import { cn } from "@/lib/utils";

export const EXPANDED_LIMIT = 20000;

interface ToolButton {
  label: string;
  icon: ReactNode;
  active: boolean;
  run: () => void;
}

function ToolbarButton({ label, icon, active, run }: ToolButton) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      title={label}
      // keep the selection in the editor
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(active && "bg-surface-2 text-accent")}
    >
      {icon}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive("bold") ?? false,
      italic: ed?.isActive("italic") ?? false,
      strike: ed?.isActive("strike") ?? false,
      h1: ed?.isActive("heading", { level: 1 }) ?? false,
      h2: ed?.isActive("heading", { level: 2 }) ?? false,
      h3: ed?.isActive("heading", { level: 3 }) ?? false,
      bullet: ed?.isActive("bulletList") ?? false,
      ordered: ed?.isActive("orderedList") ?? false,
      quote: ed?.isActive("blockquote") ?? false,
      code: ed?.isActive("codeBlock") ?? false,
      table: ed?.isActive("table") ?? false,
    }),
  });
  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const buttons: ToolButton[] = [
    { label: "Negrita", icon: <Bold aria-hidden />, active: s?.bold ?? false, run: () => chain().toggleBold().run() },
    { label: "Cursiva", icon: <Italic aria-hidden />, active: s?.italic ?? false, run: () => chain().toggleItalic().run() },
    { label: "Tachado", icon: <Strikethrough aria-hidden />, active: s?.strike ?? false, run: () => chain().toggleStrike().run() },
    { label: "Encabezado 1", icon: <Heading1 aria-hidden />, active: s?.h1 ?? false, run: () => chain().toggleHeading({ level: 1 }).run() },
    { label: "Encabezado 2", icon: <Heading2 aria-hidden />, active: s?.h2 ?? false, run: () => chain().toggleHeading({ level: 2 }).run() },
    { label: "Encabezado 3", icon: <Heading3 aria-hidden />, active: s?.h3 ?? false, run: () => chain().toggleHeading({ level: 3 }).run() },
    { label: "Lista con viñetas", icon: <List aria-hidden />, active: s?.bullet ?? false, run: () => chain().toggleBulletList().run() },
    { label: "Lista numerada", icon: <ListOrdered aria-hidden />, active: s?.ordered ?? false, run: () => chain().toggleOrderedList().run() },
    { label: "Cita", icon: <Quote aria-hidden />, active: s?.quote ?? false, run: () => chain().toggleBlockquote().run() },
    { label: "Bloque de código", icon: <Code aria-hidden />, active: s?.code ?? false, run: () => chain().toggleCodeBlock().run() },
    {
      label: "Tabla",
      icon: <Table2 aria-hidden />,
      active: s?.table ?? false,
      run: () => (s?.table ? chain().deleteTable().run() : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
    },
    { label: "Separador", icon: <Minus aria-hidden />, active: false, run: () => chain().setHorizontalRule().run() },
  ];
  return (
    <div role="toolbar" aria-label="Formato del mensaje" className="flex gap-0.5 overflow-x-auto border-b border-border pb-1">
      {buttons.map((b) => (
        <ToolbarButton key={b.label} {...b} />
      ))}
      {s?.table ? (
        <>
          <Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()}>
            Añadir fila
          </Button>
          <Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()}>
            Añadir columna
          </Button>
        </>
      ) : null}
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Draft carried over from the compact box (or from an earlier close). */
  initialDoc: unknown;
  onDraftChange: (doc: unknown | null) => void;
  canMentionEveryone: boolean;
  onAlpha?: () => void;
  /** Opens the file picker; undefined when the member cannot attach files. */
  onAttach?: () => void;
  /** Slowmode lock. */
  locked: boolean;
  sending: boolean;
  /** Resolves true when the message was posted (the dialog then closes). */
  onSend: (doc: unknown) => Promise<boolean>;
  /** Attachment thumbnails, errors and the slowmode timer, owned by the Composer. */
  status: ReactNode;
}

function ExpandedBody({ onOpenChange, initialDoc, onDraftChange, canMentionEveryone, onAlpha, onAttach, locked, sending, onSend, status }: Props) {
  const [count, setCount] = useState(() => docToPlainText(initialDoc).length);
  const editorRef = useRef<Editor | null>(null);

  const submit = async () => {
    const ed = editorRef.current;
    if (!ed || sending) return;
    const doc = ed.getJSON();
    if (await onSend(doc)) {
      onDraftChange(null);
      onOpenChange(false);
    }
  };

  const editor = useChatEditor({
    expanded: true,
    canAttach: !!onAttach,
    canMentionEveryone,
    onAlpha,
    onPickImage: () => onAttach?.(),
    onSubmit: () => void submit(),
    onUpdate: (ed) => {
      setCount(docToPlainText(ed.getJSON()).length);
      onDraftChange(docToPlainText(ed.getJSON()) === "" ? null : ed.getJSON());
    },
    editable: true,
    initialContent: initialDoc,
  });
  useEffect(() => {
    editorRef.current = editor;
    editor?.commands.focus("end");
  }, [editor]);

  const over = count > EXPANDED_LIMIT;
  return (
    <>
      <Toolbar editor={editor} />
      <div className="min-h-0 overflow-y-auto rounded-control border border-border-strong bg-bg px-3 py-2 focus-within:ring-2 focus-within:ring-accent">
        <EditorContent editor={editor} className="composer-prose min-h-40" />
      </div>
      <div className="flex flex-col gap-2">
        {status}
        <div className="flex items-center gap-1">
          {onAttach ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Adjuntar imagen" onClick={onAttach}>
              <Paperclip aria-hidden />
            </Button>
          ) : null}
          <EmojiButton editor={editor} />
          <span className="flex-1" />
          <span className={cn("text-[13px] tabular-nums", over ? "text-danger" : "text-fg-muted")}>
            {count} / {EXPANDED_LIMIT}
          </span>
          <Button type="button" onClick={() => void submit()} disabled={locked || sending || over} aria-label="Enviar mensaje">
            <Send aria-hidden />
            Enviar
          </Button>
        </div>
        <p className="hidden text-[13px] text-fg-muted sm:block">Enter inserta un salto de línea; Ctrl o Cmd + Enter envía.</p>
      </div>
    </>
  );
}

export function ComposerExpanded(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        onInteractOutside={(e) => {
          // The mention / slash popup lives in <body>, outside the dialog: clicking it must not dismiss.
          if ((e.target as HTMLElement | null)?.closest?.("[data-suggestion-popup]")) e.preventDefault();
        }}
        className="top-0 left-0 grid h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-none p-4 sm:top-1/2 sm:left-1/2 sm:h-[80vh] sm:w-full sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-panel"
      >
        <div>
          <DialogTitle>Editor ampliado</DialogTitle>
          <DialogDescription className="sr-only">
            Escribe un mensaje largo con encabezados, listas, citas, código y tablas.
          </DialogDescription>
        </div>
        <ExpandedBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
