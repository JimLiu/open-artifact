/**
 * Overview: the cover (designed at 960px, scaled to fit; only the agent
 * changes it), the README brand book and the other sections, each
 * editable in place.
 */

import { Bot, Plus } from 'lucide-react';
import { useState } from 'react';
import { MAX_SECTIONS, parseCardMarker } from '@open-artifact/design-system-core';
import { Button, Dialog, TextInput, isComposingKey, toast } from '@open-artifact/ui';
import { useFiles } from '../state/files.ts';
import { COVER, useModel } from '../state/model.ts';
import { anchorId, useView } from '../state/view.ts';
import { EditableMarkdown } from '../components/Markdown.tsx';
import { PreviewFrame } from '../components/PreviewFrame.tsx';
import { REQUESTS } from '../services/agent.ts';
import { editText } from '../services/edit.ts';
import { useFocusProps } from './common.tsx';
import { CommentBadge } from '../components/Comments.tsx';

/** Width the cover is designed at. */
const COVER_WIDTH = 960;

function Cover() {
  const preview = useFiles((s) => s.texts[`components/${COVER}/preview.html`]);
  const height = (typeof preview === 'string' ? parseCardMarker(preview)?.height : undefined) ?? 400;
  return (
    <div className="group relative mb-10 overflow-hidden rounded-xl border border-line">
      <PreviewFrame component={COVER} designWidth={COVER_WIDTH} height={height} eager />
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          size="sm"
          icon={<Bot className="size-3.5" />}
          onClick={() => {
            useView.getState().setFocus({ kind: 'cover', name: 'Cover' });
            useView.getState().openComposer(REQUESTS.cover);
          }}
        >
          Change cover
        </Button>
      </div>
    </div>
  );
}

/** A file name for a new section. */
function sectionPath(title: string, taken: ReadonlySet<string>): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  let path = `${slug}.md`;
  for (let n = 2; taken.has(path); n++) path = `${slug}-${n}.md`;
  return path;
}

function AddSection() {
  const model = useModel();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = (): void => {
    const name = title.trim();
    if (!name) return;
    if (model.sections.length >= MAX_SECTIONS) {
      toast.add({ title: `A design system has at most ${MAX_SECTIONS} sections besides the README.` });
      return;
    }
    const path = sectionPath(name, new Set(model.files.keys()));
    editText(path, `# ${name}\n\n`);
    setOpen(false);
    setTitle('');
    useView.getState().go('overview', anchorId('section', path));
  };
  return (
    <>
      <Button icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
        Add section
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a section"
        description="A Markdown page of the brand book, such as Voice, Layout or Imagery."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!title.trim()}>
              Add
            </Button>
          </>
        }
      >
        <TextInput autoFocus placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          if (isComposingKey(event.nativeEvent)) return;
          create();
        }} />
      </Dialog>
    </>
  );
}

/** One brand-book section (a Markdown file), with its comments. */
function Section({ path, source, readOnly }: { path: string; source: string; readOnly: boolean }) {
  const focus = useFocusProps({ kind: 'section', name: path });
  return (
    <section id={anchorId('section', path)} className="group relative mb-10 rounded-lg border-t border-line pt-8" {...focus}>
      <CommentBadge focus={{ kind: 'section', name: path }} className="absolute -left-8 top-8" />
      <EditableMarkdown source={source} from={path} readOnly={readOnly} onCommit={(text) => editText(path, text, path)} />
    </section>
  );
}

export function Overview() {
  const model = useModel();
  const readOnly = useFiles((s) => s.readOnly);
  const readmePath = model.readme?.path ?? 'README.md';
  const readmeFocus = useFocusProps({ kind: 'section', name: readmePath });
  return (
    <div>
      {model.hasCover ? <Cover /> : null}
      <section id={anchorId('section', readmePath)} className="group relative mb-10 rounded-lg" {...readmeFocus}>
        <CommentBadge focus={{ kind: 'section', name: readmePath }} className="absolute -left-8 top-0" />
        <EditableMarkdown
          source={model.files.get(readmePath) ?? ''}
          from={readmePath}
          readOnly={readOnly}
          placeholder="No README yet. It holds the rules for using this system: which tokens to use where, and why."
          onCommit={(text) => editText(readmePath, text, readmePath)}
        />
      </section>
      {model.sections.map((section) => (
        <Section key={section.path} path={section.path} source={model.files.get(section.path) ?? ''} readOnly={readOnly} />
      ))}
      {readOnly ? null : (
        <div className="border-t border-line pt-6">
          <AddSection />
        </div>
      )}
    </div>
  );
}
