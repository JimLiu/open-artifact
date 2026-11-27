/**
 * Code blocks: highlighting, the language picker, Copy code, live CSV, formula, Markdown and diagram blocks, and tables
 * of contents.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { Decoration, EditorView } from 'prosemirror-view';
import { addEditorExtension } from '../editor/DocEditor.tsx';
import { CodeBlockView } from './code-view.ts';
import { isPageContents } from './contents.ts';
import { ContentsView, contentsPlugin } from './contents-view.ts';
import { activeBlockPlugin, highlightPlugin } from './highlight-plugin.ts';
import './code.css';

addEditorExtension({
  plugins: () => [highlightPlugin(), activeBlockPlugin(), contentsPlugin()],
  nodeViews: {
    codeBlock: (node: PMNode, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]) =>
      isPageContents(node) ? new ContentsView(node, view, getPos, decorations) : new CodeBlockView(node, view, getPos, decorations),
  },
});
