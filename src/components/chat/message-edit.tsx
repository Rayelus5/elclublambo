"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { Loader2 } from "lucide-react";
import { useChatEditor } from "@/components/chat/composer-editor";
import { Button } from "@/components/ui/button";
import { docToPlainText, sanitizeDoc } from "@/lib/chat/content";

interface Props {
  body: unknown;
  expanded: boolean;
  canMentionEveryone: boolean;
  /** Resolves to an error message, or null when the edit was saved. */
  onSave: (doc: unknown) => Promise<string | null>;
  onCancel: () => void;
}

/** Fired by a modal parent that swallowed Escape (Radix marks it defaultPrevented) to cancel the edit instead. */
export const CANCEL_EDIT_EVENT = "chat-edit-cancel";

/** Inline editor for one's own message. Enter saves (Ctrl/Cmd+Enter in expanded messages), Escape cancels. */
export function MessageEdit({ body, expanded, canMentionEveryone, onSave, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });
  useEffect(() => {
    const el = wrapper.current;
    const handler = () => cancelRef.current();
    el?.addEventListener(CANCEL_EDIT_EVENT, handler);
    return () => el?.removeEventListener(CANCEL_EDIT_EVENT, handler);
  }, []);
  const [initial] = useState(() => sanitizeDoc(body));

  const save = async () => {
    const ed = editorRef.current;
    if (!ed || savingRef.current) return;
    const doc = ed.getJSON();
    if (docToPlainText(doc) === "") {
      setError("El mensaje no puede quedar vacío.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const err = await onSave(doc).catch(() => "No se pudo guardar el mensaje.");
    savingRef.current = false;
    setSaving(false);
    if (err) setError(err);
  };

  const editor = useChatEditor({
    expanded,
    canAttach: false,
    canMentionEveryone,
    onPickImage: () => {},
    onSubmit: () => void save(),
    onUpdate: () => setError(null),
    editable: true,
    initialContent: initial,
    label: "Editar mensaje",
  });
  useEffect(() => {
    editorRef.current = editor;
    editor?.commands.focus("end");
  }, [editor]);

  return (
    <div
      ref={wrapper}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="rounded-panel border border-border-strong bg-bg px-3 py-2 focus-within:ring-2 focus-within:ring-accent">
        <EditorContent editor={editor} className="composer-prose max-h-48 overflow-y-auto" />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
        <span className="text-[13px] text-fg-muted">
          {expanded ? "Ctrl+Enter guarda · Esc cancela" : "Enter guarda · Esc cancela"}
        </span>
      </div>
    </div>
  );
}
