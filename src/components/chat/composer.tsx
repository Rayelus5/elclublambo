"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { Loader2, Maximize2, Paperclip, Send, X } from "lucide-react";
import { AlphaDialog } from "@/components/chat/alpha-dialog";
import { ComposerExpanded } from "@/components/chat/composer-expanded";
import { useChatEditor } from "@/components/chat/composer-editor";
import { EmojiButton } from "@/components/chat/emoji-button";
import { SlowmodeTimer } from "@/components/chat/slowmode-timer";
import { Button } from "@/components/ui/button";
import { getSlowmodeAction, postMessageAction, type AttachmentInput } from "@/lib/chat/actions";
import { docToPlainText, toPlainDoc } from "@/lib/chat/content";
import { ImageError, uploadChatImage, type UploadedImage } from "@/lib/chat/upload";
import { rpcErrorMessage } from "@/lib/errors";
import { createBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export const COMPACT_LIMIT = 4000;
const EXPANDED_LIMIT = 20000;
const MAX_ATTACHMENTS = 4;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const SLOW_WAIT_COPY = "Espera a que termine el tiempo de espera del canal para enviar.";
const NO_ATTACH_COPY = "No tienes permiso para adjuntar imágenes en este canal.";

type Attachment = {
  id: string;
  name: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  uploaded?: UploadedImage;
};

export interface ComposerProps {
  channelId: string;
  threadRootId?: string;
  quoted?: { id: string; authorName: string };
  onRemoveQuoted?: () => void;
  canPost: boolean;
  canAttach: boolean;
  canMentionEveryone: boolean;
  /** The channel's configured slowmode; the live countdown always comes from the server. */
  slowmodeSeconds: number;
  onPosted?: (id: string) => void;
  /** The channel has alpha_enabled and the member has EMBED_LINKS: /alpha opens the Alpha dialog. Hidden otherwise. */
  canAlpha?: boolean;
}

function isDocEmpty(editor: Editor | null): boolean {
  return !editor || docToPlainText(editor.getJSON()) === "";
}

export function Composer(props: ComposerProps) {
  const { channelId, threadRootId, quoted, onRemoveQuoted, canPost, canAttach, canMentionEveryone, slowmodeSeconds, onPosted, canAlpha } =
    props;

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const slowRef = useRef(false);
  const [count, setCount] = useState(0);
  const [hasContent, setHasContent] = useState(false);
  const [slow, setSlow] = useState({ seconds: 0, key: 0 });
  const [slowActive, setSlowActive] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [draft, setDraft] = useState<unknown | null>(null);
  const draftRef = useRef<unknown | null>(null);
  const [alphaOpen, setAlphaOpen] = useState(false);
  const [alphaText, setAlphaText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const memberId = useRef<Promise<string> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const startSlowmode = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    setSlow((s) => ({ seconds, key: s.key + 1 }));
    slowRef.current = true;
    setSlowActive(true);
  }, []);

  // The channel may already be in cooldown when the composer mounts (e.g. after a reload).
  useEffect(() => {
    if (!canPost || slowmodeSeconds <= 0) return;
    let cancelled = false;
    void getSlowmodeAction(channelId).then((r) => {
      if (!cancelled) startSlowmode(r.seconds);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId, canPost, slowmodeSeconds, startSlowmode]);

  // Free the object URLs of the thumbnails on unmount.
  useEffect(
    () => () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
    },
    [],
  );

  const resolveMemberId = () => {
    memberId.current ??= (async () => {
      const { data, error: err } = await createBrowserClient().rpc("current_member_id");
      if (err || typeof data !== "string") throw new Error("no member");
      return data;
    })().catch((e) => {
      // Don't cache the failure: the next upload retries.
      memberId.current = null;
      throw e;
    });
    return memberId.current;
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!canAttach) {
      setError(NO_ATTACH_COPY);
      return;
    }
    const room = MAX_ATTACHMENTS - attachmentsRef.current.length;
    if (room <= 0 || files.length > room) {
      setError("Puedes adjuntar como máximo 4 imágenes.");
    } else {
      setError(null);
    }
    for (const file of files.slice(0, Math.max(0, room))) {
      const att: Attachment = { id: crypto.randomUUID(), name: file.name, previewUrl: URL.createObjectURL(file), status: "uploading" };
      attachmentsRef.current = [...attachmentsRef.current, att];
      setAttachments((list) => [...list, att]);
      void (async () => {
        try {
          const uploaded = await uploadChatImage(createBrowserClient(), channelId, await resolveMemberId(), file);
          setAttachments((list) => list.map((a) => (a.id === att.id ? { ...a, status: "done", uploaded } : a)));
        } catch (e) {
          setAttachments((list) => list.map((a) => (a.id === att.id ? { ...a, status: "error" } : a)));
          setError(e instanceof ImageError ? e.message : "No se pudo subir la imagen. Inténtalo de nuevo.");
        }
      })();
    }
  };

  const removeAttachment = (id: string) => {
    const target = attachmentsRef.current.find((a) => a.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    attachmentsRef.current = attachmentsRef.current.filter((a) => a.id !== id);
    setAttachments((list) => list.filter((a) => a.id !== id));
    setError(null);
  };

  /** Shared by the compact box and the expanded dialog. Resolves true when the message was posted. */
  const send = async (doc: unknown, expanded: boolean): Promise<boolean> => {
    if (sendingRef.current || !canPost) return false;
    if (slowRef.current) {
      setError(SLOW_WAIT_COPY);
      return false;
    }
    const current = attachmentsRef.current;
    if (current.some((a) => a.status === "uploading")) {
      setError("Espera a que terminen de subir las imágenes.");
      return false;
    }
    const done = current.filter((a): a is Attachment & { uploaded: UploadedImage } => a.status === "done" && !!a.uploaded);
    const length = docToPlainText(doc).length;
    if (length === 0 && done.length === 0) return false;
    if (length > (expanded ? EXPANDED_LIMIT : COMPACT_LIMIT)) {
      setError(rpcErrorMessage("too_long"));
      return false;
    }

    sendingRef.current = true;
    setSending(true);
    setError(null);
    const attachmentsPayload: AttachmentInput[] = done.map((a) => a.uploaded);
    const res = await postMessageAction({
      channelId,
      doc: toPlainDoc(doc),
      expanded,
      threadRootId,
      quotedId: quoted?.id,
      attachments: attachmentsPayload,
    }).catch(() => ({ error: "unknown" }) as { id?: string; error?: string; slowmodeSeconds?: number });
    sendingRef.current = false;
    setSending(false);

    if (res.error || !res.id) {
      if (res.error === "slowmode") {
        // The error detail may be missing: ask the server clock before giving up.
        let seconds = res.slowmodeSeconds ?? 0;
        if (seconds <= 0) seconds = (await getSlowmodeAction(channelId).catch(() => ({ seconds: 0 }))).seconds;
        if (seconds > 0) startSlowmode(seconds);
        else setError(rpcErrorMessage("slowmode"));
      } else setError(rpcErrorMessage(res.error ?? "unknown"));
      return false;
    }

    editorRef.current?.commands.clearContent(true);
    setCount(0);
    setHasContent(false);
    for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
    attachmentsRef.current = [];
    setAttachments([]);
    setDraft(null);
    draftRef.current = null;
    onRemoveQuoted?.();
    onPosted?.(res.id);
    if (slowmodeSeconds > 0) void getSlowmodeAction(channelId).then((r) => startSlowmode(r.seconds));
    return true;
  };

  const openAlpha = useCallback(() => {
    // The thesis starts from whatever is being drafted (compact box or expanded draft).
    const ed = editorRef.current;
    const fromBox = ed ? docToPlainText(ed.getJSON()) : "";
    setAlphaText(fromBox !== "" ? fromBox : draftRef.current ? docToPlainText(draftRef.current) : "");
    setExpandedOpen(false);
    setAlphaOpen(true);
  }, []);
  const onAlpha = canAlpha ? openAlpha : undefined;

  const editor = useChatEditor({
    expanded: false,
    canAttach,
    canMentionEveryone,
    onAlpha,
    onPickImage: () => fileInput.current?.click(),
    onSubmit: () => {
      const ed = editorRef.current;
      if (ed) void send(ed.getJSON(), false);
    },
    onUpdate: (ed) => {
      setCount(docToPlainText(ed.getJSON()).length);
      setHasContent(!isDocEmpty(ed));
      setError(null);
    },
    // The cooldown only locks sending: members can keep drafting.
    editable: canPost,
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const openExpanded = () => {
    const ed = editorRef.current;
    if (ed && !isDocEmpty(ed)) {
      // The compact schema is a subset of the expanded one: move the text over, don't duplicate it.
      draftRef.current = ed.getJSON();
      setDraft(ed.getJSON());
      ed.commands.clearContent(true);
      setCount(0);
      setHasContent(false);
    }
    setExpandedOpen(true);
  };

  if (!canPost) {
    return (
      <div className="border-t border-border bg-surface px-4 py-3 text-sm text-fg-muted">
        <p>No tienes permiso para escribir en este canal.</p>
      </div>
    );
  }

  const locked = slowActive;
  const uploading = attachments.some((a) => a.status === "uploading");
  const hasDone = attachments.some((a) => a.status === "done");
  const canSend = !locked && !sending && !uploading && (hasContent || hasDone) && count <= COMPACT_LIMIT;
  const nearLimit = count >= COMPACT_LIMIT * 0.9;

  const status = (
    <>
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Imágenes adjuntas">
          {attachments.map((a) => (
            <li key={a.id} className="relative size-16 overflow-hidden rounded-control border border-border-strong bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={a.previewUrl} alt={a.name} className={cn("size-full object-cover", a.status !== "done" && "opacity-50")} />
              {a.status === "uploading" ? (
                <Loader2 aria-label="Subiendo" role="status" className="absolute inset-0 m-auto size-5 animate-spin motion-reduce:animate-none" />
              ) : null}
              <button
                type="button"
                aria-label={`Quitar ${a.name}`}
                onClick={() => removeAttachment(a.id)}
                className="absolute top-0 right-0 flex size-11 items-start justify-end p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex size-5 items-center justify-center rounded-control bg-bg/90 text-fg">
                  <X aria-hidden className="size-3.5" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SlowmodeTimer
        seconds={slow.seconds}
        resetKey={slow.key}
        onElapsed={() => {
          slowRef.current = false;
          setSlowActive(false);
          // The "Espera…" alert is stale once the cooldown is over.
          setError((e) => (e === SLOW_WAIT_COPY ? null : e));
        }}
      />
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );

  return (
    <section
      aria-label="Redactar mensaje"
      className="border-t border-border bg-surface p-3"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return;
        e.preventDefault();
        addFiles(files);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return;
        e.preventDefault();
        addFiles(files);
      }}
    >
      {quoted ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-control border border-border bg-surface-2 pl-3 text-sm">
          <span className="truncate text-fg-muted">Citando a {quoted.authorName}</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar cita" onClick={onRemoveQuoted}>
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-panel border border-border-strong bg-bg px-3 py-2 focus-within:ring-2 focus-within:ring-accent",
          locked && "opacity-60",
        )}
      >
        <EditorContent editor={editor} className="composer-prose max-h-48 overflow-y-auto" />
      </div>

      <div className="mt-2 flex flex-col gap-2">{status}</div>

      <div className="mt-1 flex items-center gap-1">
        {canAttach ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Adjuntar imagen"
            disabled={sending || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip aria-hidden />
          </Button>
        ) : null}
        <EmojiButton editor={editor} />
        <Button type="button" variant="ghost" size="icon" aria-label="Expandir editor" onClick={openExpanded}>
          <Maximize2 aria-hidden />
        </Button>
        {draft ? <span className="text-[13px] text-fg-muted">Borrador en el editor ampliado</span> : null}
        <span className="flex-1" />
        {nearLimit ? (
          <span className={cn("text-[13px] tabular-nums", count > COMPACT_LIMIT ? "text-danger" : "text-fg-muted")}>
            {count} / {COMPACT_LIMIT}
          </span>
        ) : null}
        <Button
          type="button"
          aria-label="Enviar mensaje"
          disabled={!canSend}
          onClick={() => {
            const ed = editorRef.current;
            if (ed) void send(ed.getJSON(), false);
          }}
        >
          {sending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
          Enviar
        </Button>
      </div>

      {canAttach ? (
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      ) : null}

      <ComposerExpanded
        open={expandedOpen}
        onOpenChange={setExpandedOpen}
        initialDoc={draft}
        onDraftChange={(doc) => {
          const next = doc && docToPlainText(doc) !== "" ? doc : null;
          draftRef.current = next;
          setDraft(next);
        }}
        canMentionEveryone={canMentionEveryone}
        onAlpha={onAlpha}
        onAttach={canAttach ? () => fileInput.current?.click() : undefined}
        locked={locked}
        sending={sending}
        onSend={(doc) => send(doc, true)}
        status={status}
      />
      {canAlpha ? (
        <AlphaDialog
          open={alphaOpen}
          onOpenChange={setAlphaOpen}
          channelId={channelId}
          initialText={alphaText}
          onPosted={(id) => {
            // The thesis moved into the Alpha message: the drafts are spent.
            editorRef.current?.commands.clearContent(true);
            setCount(0);
            setHasContent(false);
            setDraft(null);
            draftRef.current = null;
            if (slowmodeSeconds > 0) void getSlowmodeAction(channelId).then((r) => startSlowmode(r.seconds));
            onPosted?.(id);
          }}
        />
      ) : null}
    </section>
  );
}
