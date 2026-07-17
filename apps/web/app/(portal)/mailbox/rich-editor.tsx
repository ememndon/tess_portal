"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Compose rich-text editor. Self-contained (no external editor lib, so
 * it needs no bundle/CSP concessions) built on a contentEditable surface
 * with a formatting toolbar. Emits HTML via onChange; the send transform
 * derives the plaintext part. Pasted content is stripped of scripts.
 */

type Cmd = { icon: React.ReactNode; title: string; run: () => void; active?: string };

export function RichEditor({
  initialHtml,
  onChange,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml;
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML ?? "");
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* execCommand can throw on odd selections */
    }
    emit();
  };

  const link = () => {
    const url = window.prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  };

  const Btn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] px-1.5 text-[12px] text-muted hover:bg-raised hover:text-fg"
    >
      {children}
    </button>
  );
  const Sep = () => <span className="mx-0.5 h-[16px] w-px self-center bg-line" />;

  return (
    <div className="rounded-input border border-line bg-bg">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        <Btn title="Undo" onClick={() => exec("undo")}>↶</Btn>
        <Btn title="Redo" onClick={() => exec("redo")}>↷</Btn>
        <Sep />
        <Btn title="Bold" onClick={() => exec("bold")}><b>B</b></Btn>
        <Btn title="Italic" onClick={() => exec("italic")}><i>I</i></Btn>
        <Btn title="Underline" onClick={() => exec("underline")}><u>U</u></Btn>
        <Btn title="Strikethrough" onClick={() => exec("strikeThrough")}><s>S</s></Btn>
        <Sep />
        <select
          title="Text size"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            exec("fontSize", e.target.value);
            e.target.selectedIndex = 0;
          }}
          className="h-[26px] rounded-[6px] bg-transparent px-1 text-[11px] text-muted hover:bg-raised"
          defaultValue=""
        >
          <option value="" disabled>Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="6">Huge</option>
        </select>
        <label title="Text color" className="flex h-[26px] cursor-pointer items-center rounded-[6px] px-1 hover:bg-raised" onMouseDown={(e) => e.preventDefault()}>
          <span className="text-[12px] text-muted">A</span>
          <input type="color" onChange={(e) => exec("foreColor", e.target.value)} className="h-0 w-0 opacity-0" />
        </label>
        <label title="Highlight" className="flex h-[26px] cursor-pointer items-center rounded-[6px] px-1 hover:bg-raised" onMouseDown={(e) => e.preventDefault()}>
          <span className="rounded-[3px] bg-amber/40 px-0.5 text-[12px] text-muted">H</span>
          <input type="color" onChange={(e) => exec("hiliteColor", e.target.value)} className="h-0 w-0 opacity-0" />
        </label>
        <Sep />
        <Btn title="Bulleted list" onClick={() => exec("insertUnorderedList")}>•</Btn>
        <Btn title="Numbered list" onClick={() => exec("insertOrderedList")}>1.</Btn>
        <Btn title="Decrease indent" onClick={() => exec("outdent")}>⇤</Btn>
        <Btn title="Increase indent" onClick={() => exec("indent")}>⇥</Btn>
        <Btn title="Quote" onClick={() => exec("formatBlock", "blockquote")}>❝</Btn>
        <Sep />
        <Btn title="Align left" onClick={() => exec("justifyLeft")}>⯇</Btn>
        <Btn title="Align center" onClick={() => exec("justifyCenter")}>≡</Btn>
        <Btn title="Align right" onClick={() => exec("justifyRight")}>⯈</Btn>
        <Sep />
        <Btn title="Insert link" onClick={link}>🔗</Btn>
        <Btn title="Code block" onClick={() => exec("formatBlock", "pre")}>{"</>"}</Btn>
        <Btn title="Horizontal line" onClick={() => exec("insertHorizontalRule")}>―</Btn>
        <Btn title="Clear formatting" onClick={() => exec("removeFormat")}>✕ᶠ</Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={emit}
        onPaste={(e) => {
          // strip scripts/styles from pasted HTML; keep basic formatting
          const html = e.clipboardData.getData("text/html");
          if (html) {
            e.preventDefault();
            const clean = html
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/ on\w+="[^"]*"/gi, "")
              .replace(/ on\w+='[^']*'/gi, "");
            document.execCommand("insertHTML", false, clean);
            emit();
          }
        }}
        className={cn(
          // compose on a white canvas (WYSIWYG — matches how the message renders
          // for you and your recipients); the toolbar/chrome stays dark
          "mail-compose max-h-[42vh] min-h-[180px] overflow-y-auto rounded-b-input bg-white px-3 py-2.5 text-[12.5px] leading-[1.55] text-[#1f2328] outline-none",
          "[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[#d0d7de] [&_blockquote]:pl-2.5 [&_blockquote]:text-[#57606a]",
          "[&_a]:text-[#0b57d0] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_pre]:rounded [&_pre]:bg-[#f6f8fa] [&_pre]:p-2",
        )}
      />
    </div>
  );
}
