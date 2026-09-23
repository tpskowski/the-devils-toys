import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Editor, defaultValueCtx, editorViewCtx, remarkPluginsCtx, rootCtx } from "@milkdown/kit/core";
import {
  commonmark,
  remarkPreserveEmptyLinePlugin,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { history, undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { SlashProvider, slashFactory } from "@milkdown/kit/plugin/slash";
import { TextSelection } from "@milkdown/kit/prose/state";
import { $nodeSchema, callCommand, getMarkdown } from "@milkdown/kit/utils";
import { Bold, Italic, Code, Heading2, Heading3, Pilcrow, List, ListOrdered, Quote, Undo2, Redo2 } from "lucide-react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { normalizeWikiBreaks, remarkWiki, remarkWikiSpacing, type WikiMentionKind } from "@devils-toys/shared";
import { api } from "./api";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./WikiEditor.css";

/** Kept deliberately local: changing text does not change the document's
 * revision or save it. The parent only receives a settled Markdown snapshot. */
export const WIKI_EDITOR_DEBOUNCE_MS = 180;

// Milkdown registers command keys on mount, so resolve them only on click.
const formattingActions = [
  { label: "Bold", icon: Bold, command: () => callCommand(toggleStrongCommand.key) },
  { label: "Italic", icon: Italic, command: () => callCommand(toggleEmphasisCommand.key) },
  { label: "Inline code", icon: Code, command: () => callCommand(toggleInlineCodeCommand.key) },
  { label: "Paragraph", icon: Pilcrow, command: () => callCommand(turnIntoTextCommand.key) },
  { label: "Heading 2", icon: Heading2, command: () => callCommand(wrapInHeadingCommand.key, 2) },
  { label: "Heading 3", icon: Heading3, command: () => callCommand(wrapInHeadingCommand.key, 3) },
  { label: "Bullet list", icon: List, command: () => callCommand(wrapInBulletListCommand.key) },
  { label: "Numbered list", icon: ListOrdered, command: () => callCommand(wrapInOrderedListCommand.key) },
  { label: "Block quote", icon: Quote, command: () => callCommand(wrapInBlockquoteCommand.key) },
  { label: "Undo", icon: Undo2, command: () => callCommand(undoCommand.key) },
  { label: "Redo", icon: Redo2, command: () => callCommand(redoCommand.key) }
];

export interface WikiEditorHandle {
  markdown(): string;
  flush(): string;
}

interface WikiEditorProps {
  roomId: number;
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  onReady: (handle: WikiEditorHandle | undefined) => void;
}

export interface WikiMentionable {
  kind: WikiMentionKind;
  label: string;
  id?: number | string;
  slug?: string;
}

/** The final @word at a text-block's cursor is the only thing the picker owns. */
export function wikiMentionQuery(text: string) {
  return /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];
}

/** The exact mdast shape the Milkdown atom writes back through remark-directive. */
export function wikiMentionSource(kind: WikiMentionKind, target: string, label: string) {
  const targetName = kind === "page" ? "slug" : "id";
  return {
    name: kind,
    attributes: { [targetName]: target },
    children: [{ type: "text", value: label }]
  };
}

/** An inline atom keeps a saved directive intact while making it legible in Milkdown. */
const wikiMentionSchema = $nodeSchema("wikiMention", () => ({
  inline: true,
  group: "inline",
  atom: true,
  attrs: {
    kind: { default: "npc" },
    target: { default: "" },
    label: { default: "" }
  },
  parseDOM: [
    {
      tag: "wiki-mention",
      getAttrs: (element) => {
        if (!(element instanceof HTMLElement)) return false;
        return {
          kind: element.dataset.wikiKind ?? "npc",
          target: element.dataset.wikiTarget ?? "",
          label: element.textContent ?? ""
        };
      }
    }
  ],
  toDOM: (node) => [
    "wiki-mention",
    {
      class: `wiki-mention wiki-mention-${node.attrs.kind}`,
      "data-wiki-kind": node.attrs.kind,
      "data-wiki-target": node.attrs.target
    },
    node.attrs.label
  ],
  parseMarkdown: {
    match: (node) => node.type === "wikiMention",
    runner: (state, node, type) =>
      state.addNode(type, {
        kind: String(node.kind ?? "npc"),
        target: String(node.target ?? ""),
        label: String(node.label ?? "")
      })
  },
  toMarkdown: {
    match: (node) => node.type.name === "wikiMention",
    runner: (state, node) => {
      const source = wikiMentionSource(node.attrs.kind as WikiMentionKind, node.attrs.target, node.attrs.label);
      state.addNode("textDirective", source.children, undefined, { name: source.name, attributes: source.attributes });
    }
  }
}));

const wikiMentionPicker = slashFactory("WIKI_MENTION_PICKER");

/** A small DOM picker keeps React out of Milkdown's ProseMirror lifecycle. */
class WikiMentionPickerView {
  private readonly content = document.createElement("div");
  private readonly provider: SlashProvider;
  private entries: WikiMentionable[] = [];
  private query = "";
  private searchVersion = 0;

  constructor(
    private readonly roomId: number,
    private readonly view: import("@milkdown/kit/prose/view").EditorView
  ) {
    this.content.className = "wiki-mention-picker";
    this.content.setAttribute("role", "listbox");
    this.content.setAttribute("aria-label", "Mention a room entry");
    const self = this;
    this.provider = new SlashProvider({
      content: this.content,
      trigger: "@",
      debounce: 20,
      shouldShow(this: SlashProvider, view) {
        if (!(view.state.selection instanceof TextSelection) || !view.state.selection.empty) return false;
        const text = this.getContent(view, (node) => ["paragraph", "heading"].includes(node.type.name));
        const query = text === undefined ? undefined : wikiMentionQuery(text);
        if (query === undefined) return false;
        self.setQuery(query);
        return true;
      },
      offset: 8,
      root: document.body
    });
    this.provider.onHide = () => {
      this.content.dataset.show = "false";
    };
  }

  update = (
    view: import("@milkdown/kit/prose/view").EditorView,
    previous?: import("@milkdown/kit/prose/state").EditorState
  ) => {
    this.provider.update(view, previous);
  };

  destroy = () => {
    this.provider.destroy();
    this.content.remove();
  };

  private setQuery(query: string) {
    if (query === this.query && this.content.dataset.show === "true") return;
    this.query = query;
    const version = ++this.searchVersion;
    api<{ mentionables: WikiMentionable[] }>(
      `/api/rooms/${this.roomId}/wiki/mentionables?q=${encodeURIComponent(query)}`
    )
      .then((result) => {
        if (version !== this.searchVersion) return;
        this.entries = result.mentionables;
        this.render();
      })
      .catch(() => {
        if (version !== this.searchVersion) return;
        this.entries = [];
        this.render();
      });
  }

  private render() {
    this.content.replaceChildren();
    if (!this.entries.length) {
      const empty = document.createElement("p");
      empty.textContent = "No visible entries";
      this.content.append(empty);
      return;
    }
    for (const entry of this.entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.dataset.kind = entry.kind;
      button.textContent = entry.label;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => this.select(entry));
      this.content.append(button);
    }
  }

  private select(entry: WikiMentionable) {
    const target = entry.kind === "page" ? entry.slug : entry.id;
    if (target === undefined) return;
    const { state } = this.view;
    const end = state.selection.from;
    const start = end - this.query.length - 1;
    const type = state.schema.nodes.wikiMention;
    if (!type || start < 0) return;
    const node = type.create({ kind: entry.kind, target: String(target), label: entry.label });
    this.view.dispatch(state.tr.replaceWith(start, end, node));
    this.provider.hide();
    this.view.focus();
  }
}

class EditorBoundary extends Component<{ onError: () => void; children: ReactNode }> {
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  render() {
    return this.props.children;
  }
}

function MarkdownFallback({ markdown, onMarkdownChange, onReturn }: WikiEditorProps & { onReturn: () => void }) {
  return (
    <div className="wiki-markdown-fallback">
      <div className="wiki-editor-mode">
        <p>Plain Markdown editor</p>
        <button type="button" onClick={onReturn}>
          Try rich editor
        </button>
      </div>
      <textarea
        value={markdown}
        onChange={(event) => onMarkdownChange(event.target.value)}
        placeholder="Write in Markdown…"
        aria-label="Page Markdown"
      />
    </div>
  );
}

function MilkdownEditor({
  roomId,
  markdown,
  onMarkdownChange,
  onReady,
  onFallback
}: WikiEditorProps & { onFallback: () => void }) {
  const [initialMarkdown] = useState(() => normalizeWikiBreaks(markdown));
  const markdownRef = useRef(initialMarkdown);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const timerRef = useRef<number | undefined>(undefined);
  const editorGetterRef = useRef<() => Editor | undefined>(() => undefined);

  const flush = useCallback(() => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    // Milkdown's listener serializes changes on its own 200 ms debounce. Save
    // must read the live document instead so a click immediately after typing
    // cannot submit the previous listener snapshot.
    const nextMarkdown = editorGetterRef.current()?.action(getMarkdown()) ?? markdownRef.current;
    markdownRef.current = nextMarkdown;
    onMarkdownChange(nextMarkdown);
    return nextMarkdown;
  }, [onMarkdownChange]);

  const queueChange = useCallback(
    (nextMarkdown: string) => {
      markdownRef.current = nextMarkdown;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        onMarkdownChange(nextMarkdown);
      }, WIKI_EDITOR_DEBOUNCE_MS);
    },
    [onMarkdownChange]
  );

  const editor = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdownRef.current);
          // Milkdown stores plugins as an attacher plus an options object. The
          // shared attacher takes no options, but unified safely calls it with
          // this empty record when rebuilding its parser and serializer.
          ctx.set(remarkPluginsCtx, [
            { plugin: remarkWiki() as never, options: {} },
            { plugin: remarkWikiSpacing() as never, options: {} }
          ]);
          ctx.set(wikiMentionPicker.key, {
            view: (view) => new WikiMentionPickerView(roomId, view)
          });
          ctx.get(listenerCtx).markdownUpdated((_ctx, nextMarkdown, previousMarkdown) => {
            if (nextMarkdown !== previousMarkdown) queueChange(nextMarkdown);
          });
        })
        .use(wikiMentionSchema)
        // Empty paragraphs stay blank Markdown lines, not literal <br /> tags.
        .use(commonmark.filter((plugin) => !remarkPreserveEmptyLinePlugin.includes(plugin)))
        .use(gfm)
        .use(history)
        .use(listener)
        .use(clipboard)
        .use(cursor)
        .use(trailing)
        .use(wikiMentionPicker),
    [queueChange, roomId]
  );
  editorGetterRef.current = editor.get;

  useEffect(() => {
    onReady({ markdown: () => markdownRef.current, flush });
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      onReady(undefined);
    };
  }, [flush, onReady]);

  return (
    <>
      <div className="wiki-editor-mode">
        <p>Rich editor</p>
        <div className="wiki-editor-mode-actions">
          <button type="button" aria-expanded={toolbarVisible} onClick={() => setToolbarVisible((visible) => !visible)}>
            {toolbarVisible ? "Hide toolbar" : "Show toolbar"}
          </button>
          <button
            type="button"
            onClick={() => {
              // This is a mode switch rather than navigation, so the workspace
              // cannot flush on our behalf. Preserve text still in the local
              // debounce before replacing Milkdown with the textarea.
              flush();
              onFallback();
            }}
          >
            Use plain Markdown
          </button>
        </div>
      </div>
      {toolbarVisible && (
        <div className="wiki-formatting-toolbar" role="group" aria-label="Text formatting">
          {formattingActions.map(({ label, icon: Icon, command }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              disabled={editor.loading}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                editor.get()?.action((ctx) => {
                  command()(ctx);
                  ctx.get(editorViewCtx).focus();
                })
              }
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      )}
      <Milkdown />
    </>
  );
}

/** A dynamically imported editor view. Milkdown never reaches a read-only wiki
 * session because WikiWorkspace only renders this module while editing. */
export function WikiEditor(props: WikiEditorProps) {
  const [fallback, setFallback] = useState(false);

  if (fallback) {
    return <MarkdownFallback {...props} onReturn={() => setFallback(false)} />;
  }

  return (
    <div className="wiki-milkdown">
      <EditorBoundary onError={() => setFallback(true)}>
        <MilkdownProvider>
          <MilkdownEditor {...props} onFallback={() => setFallback(true)} />
        </MilkdownProvider>
      </EditorBoundary>
    </div>
  );
}
