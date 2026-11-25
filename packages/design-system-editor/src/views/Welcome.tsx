import { Code2, FolderUp, Layers, PenLine, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, IconButton, cn, toast } from '@open-artifact/ui';
import { isDirty, useFiles } from '../state/files.ts';
import { useModel } from '../state/model.ts';
import { useView } from '../state/view.ts';
import { REQUESTS, sendPrepared } from '../services/agent.ts';
import { importBrandFiles, removeImportedFile, type ImportedFile } from '../services/edit.ts';
import { flush } from '../services/sync.ts';
import { session } from '../services/session.ts';
import { droppedBrandFiles } from '../lib/drop-files.ts';

const routes = [
  { title: 'Sync from GitHub', icon: Code2, description: 'Bring in tokens, fonts and components from a repository.', request: REQUESTS.fromCode },
  { title: 'Build from connectors', icon: Layers, description: 'Find brand files in a connected design tool, drive or wiki.', request: REQUESTS.fromConnectors },
];

export function Welcome({ setIntake, intakeDrop }: { setIntake(active: boolean): void; intakeDrop: RefObject<((files: File[]) => Promise<void>) | null> }) {
  const { index } = useModel();
  const readOnly = useFiles((s) => s.readOnly);
  const [panel, setPanel] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [kept, setKept] = useState<ImportedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const choose = async (files: File[]) => {
    if (!files.length || busy || readOnly) return;
    setPanel(true);
    setIntake(true);
    setBusy(true);
    setNotice('');
    try {
      const saved = await importBrandFiles(files);
      const accepted = new Set(saved.map((item) => item.file));
      const refused = files.filter((file) => !accepted.has(file));
      setKept((previous) => [...previous, ...saved]);
      setPending((previous) => [...previous.filter((file) => !files.includes(file)), ...refused]);
      if (refused.length) setNotice('Some files could not be added. Retry or remove them.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    intakeDrop.current = choose;
    return () => { intakeDrop.current = null; };
  });
  const remove = async (item: ImportedFile) => {
    setBusy(true);
    try {
      if (await removeImportedFile(item)) setKept((list) => list.filter((entry) => entry !== item));
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      await flush();
      if (isDirty(useFiles.getState()) || useFiles.getState().save === 'offline') {
        setNotice('The files are still saving. Try Create design system again after they sync.');
        return;
      }
      const result = await sendPrepared(REQUESTS.fromUploads, '', 'Create design system');
      if (result && result.status !== 'failed') setIntake(false);
    } finally {
      setBusy(false);
    }
  };
  const request = async (text: string, title: string) => {
    setBusy(true);
    try {
      await sendPrepared(text, '', title);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn('mx-auto max-w-2xl py-6', dropping && 'outline-2 outline-dashed outline-accent')}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDropping(!readOnly && !busy);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(false);
        if (!busy && !readOnly) void droppedBrandFiles(event.dataTransfer).then(choose).catch(() => toast.add({ title: 'Could not read these files' }));
      }}>
      <h1 className="mb-4 text-[24px] font-semibold tracking-tight">{panel ? 'Upload your brand’s files' : index.title}</h1>
      {panel ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">Drop logos, fonts, brand guidelines and token files here.</p>
          <input type="file" multiple hidden ref={filesInput} onChange={(event) => { void choose([...event.target.files ?? []]); event.target.value = ''; }} />
          <input type="file" multiple hidden ref={folderInput} {...{ webkitdirectory: '' }} onChange={(event) => { void choose([...event.target.files ?? []]); event.target.value = ''; }} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || readOnly} icon={<Upload />} onClick={() => filesInput.current?.click()}>Choose files</Button>
            <Button disabled={busy || readOnly} icon={<FolderUp />} onClick={() => folderInput.current?.click()}>Choose a folder</Button>
          </div>
          <ul className="space-y-1 text-sm">
            {kept.map((item, i) => <li key={i} className="flex items-center gap-2">
              {item.file.webkitRelativePath || item.file.name} · Added
              <IconButton label={`Remove ${item.file.name}`} disabled={busy || readOnly} icon={<X />} onClick={() => void remove(item)} />
            </li>)}
            {pending.map((file, i) => <li key={i} className="flex items-center gap-2">
              {file.webkitRelativePath || file.name}
              <IconButton label={`Remove ${file.name}`} disabled={busy} icon={<X />} onClick={() => setPending((list) => list.filter((_, n) => i !== n))} />
            </li>)}
          </ul>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => { setPanel(false); setIntake(false); setPending([]); setKept([]); setNotice(''); }}>Back</Button>
            {pending.length > 0 && <Button disabled={busy || readOnly} onClick={() => void choose(pending)}>Retry files</Button>}
            <Button variant="primary" disabled={readOnly || busy || !session().isOwner || !kept.length} onClick={() => void create()}>Create design system</Button>
          </div>
          <span role="status" className="text-sm text-fg-muted">{busy ? 'Adding brand files…' : notice}</span>
        </div>
      ) : (
        <>
          <h2 className="mb-3 font-medium">Not sure where to start?</h2>
          <div className="grid gap-2">
            {routes.map(({ title, description, icon: Icon, request: text }) => (
              <button key={title} type="button" disabled={readOnly || busy || !session().isOwner} onClick={() => void request(text, title)} className="flex items-center gap-3 rounded-lg border border-line p-3 text-left hover:bg-hover disabled:opacity-50">
                <Icon className="size-5 shrink-0 text-accent" /><span><strong className="block text-sm">{title}</strong><span className="text-sm text-fg-muted">{description}</span></span>
              </button>
            ))}
            <button type="button" disabled={readOnly || busy} onClick={() => setPanel(true)} className="flex items-center gap-3 rounded-lg border border-line p-3 text-left hover:bg-hover disabled:opacity-50">
              <Upload className="size-5 text-accent" /><span><strong className="block text-sm">Upload brand files</strong><span className="text-sm text-fg-muted">Start with your logos, fonts and imagery.</span></span>
            </button>
            {/* By hand, no agent: the sections below take colors, type, spacing and assets as they are. */}
            <button type="button" data-testid="ds-start-by-hand" disabled={readOnly} onClick={() => useView.getState().go('colors')} className="flex items-center gap-3 rounded-lg border border-line p-3 text-left hover:bg-hover disabled:opacity-50">
              <PenLine className="size-5 text-accent" /><span><strong className="block text-sm">Start by hand</strong><span className="text-sm text-fg-muted">Add colors, type, spacing and assets yourself, section by section.</span></span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
