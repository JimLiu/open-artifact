/** The top bar's Export menu: Word, PDF (Letter or A4), Markdown or HTML; a doc of several tabs then asks which. */
import { ChromeButton, ChromeMenu, ChromeMenuItem, ChromeSubmenu } from '@open-artifact/editor-kit/react';
import type { DocExportFormat, DocPaper } from '@open-artifact/runtime/doc-api';
import { Download } from 'lucide-react';
import { type ReactNode } from 'react';
import { maybeSession } from '../app/session.ts';
import { useDocs } from '../app/store.ts';
import { exportAsking, exportKey, mayExportDoc } from './export.ts';
import { FORMAT_NAMES, defaultPaper } from './words.ts';
import { useTopBar } from './store.ts';

const DESCRIBED: Record<DocExportFormat, string> = {
  docx: 'as a Word document',
  pdf: 'as a PDF to read or print',
  markdown: 'as plain text',
  html: 'as a web page',
};

const FILE_LABEL: Record<DocExportFormat, string> = { docx: 'Word (.docx)', pdf: 'PDF (.pdf)', markdown: 'Markdown (.md)', html: 'HTML (.html)' };

function Item({ format, paper, label, description }: { format: DocExportFormat; paper?: DocPaper; label: string; description?: string }): ReactNode {
  const exporting = useTopBar(state => state.exporting);
  const busy = exporting === exportKey({ format, ...(paper ? { paper } : {}) });
  return (
    <ChromeMenuItem disabled={exporting !== null} description={description} onSelect={() => void exportAsking(format, paper)}>
      {busy ? `Exporting to ${FORMAT_NAMES[format]}…` : label}
    </ChromeMenuItem>
  );
}

export function ExportMenu(): ReactNode {
  const ready = useDocs(state => state.phase.kind === 'ready');
  if (!ready || !maybeSession() || !mayExportDoc()) return null;
  const paper = defaultPaper();
  return (
    <ChromeMenu
      align="end"
      tip={{ label: 'Export' }}
      trigger={
        <ChromeButton square aria-label="Export">
          <Download className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      <Item format="docx" label={FILE_LABEL.docx} description={`The document ${DESCRIBED.docx}`} />
      <ChromeSubmenu label={FILE_LABEL.pdf}>
        <Item format="pdf" paper="letter" label={paper === 'letter' ? 'Letter (default)' : 'Letter'} description="8.5 × 11 in" />
        <Item format="pdf" paper="a4" label={paper === 'a4' ? 'A4 (default)' : 'A4'} description="210 × 297 mm" />
      </ChromeSubmenu>
      <Item format="markdown" label={FILE_LABEL.markdown} description={`The document ${DESCRIBED.markdown}`} />
      <Item format="html" label={FILE_LABEL.html} description={`The document ${DESCRIBED.html}`} />
    </ChromeMenu>
  );
}
