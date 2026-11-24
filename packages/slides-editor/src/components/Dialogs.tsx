/**
 * The editor's dialogs: the new-slide layout picker, scale the selection
 * (K), insert or change a video link, insert a table, the keyboard
 * shortcuts, the PDF and web page download options, "download anyway?"
 * while the agent is still writing the deck, and the notes of the last
 * download (what it could not carry over).
 */

import { localize, uiLocale } from '@open-artifact/runtime';
import { useMemo, useState, type ReactNode } from 'react';
import { LAYOUT_IDS, LIMITS, VIDEO_PROVIDERS, layoutName, makeLayout, parseVideoUrl, pinnedRectOf, videoProviderLabel, type LayoutId } from '@open-artifact/slides-core';
import { Button, Dialog, NumberInput, Segmented, SwitchInput, cn } from '@open-artifact/ui';
import { useSelectedNodes } from '../state/selection.ts';
import { useUi } from '../state/ui.ts';
import { insertVideoLink } from '../services/assets.ts';
import { addSlide, insertTable, scaleSelection } from '../services/commands.ts';
import type { HtmlQuality, PdfQuality } from '../services/exports.ts';
import { session } from '../services/session.ts';
import { answerPartialExport, startExport, useExportUi } from '../services/shell.ts';
import { SlideThumb } from './SlideThumb.tsx';
import { MOD } from '@open-artifact/editor-kit';

/** The dialogs, mounted once by the app. */
export function Dialogs(): ReactNode {
  const dialog = useUi((s) => s.dialog);
  const close = (): void => useUi.getState().close();
  return (
    <>
      {dialog === 'newSlide' ? <NewSlideDialog onClose={close} /> : null}
      {dialog === 'scale' ? <ScaleDialog onClose={close} /> : null}
      {dialog === 'videoLink' ? <VideoLinkDialog onClose={close} /> : null}
      {dialog === 'table' ? <TableDialog onClose={close} /> : null}
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={close} />
      <PdfDialog />
      <HtmlDialog />
      <PartialExportDialog />
      <ExportNotesDialog />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* New slide                                                                   */
/* -------------------------------------------------------------------------- */

/** A layout's preview slide (built once per layout). */
function LayoutPreview({ layout }: { layout: LayoutId }): ReactNode {
  const slide = useMemo(() => makeLayout(layout, `preview-${layout}`), [layout]);
  return <SlideThumb slide={slide} />;
}

/** "New slide": pick a layout; the slide goes after the current one. */
function NewSlideDialog({ onClose }: { onClose: () => void }): ReactNode {
  const pick = (layout: LayoutId): void => {
    onClose();
    addSlide(layout);
  };
  return (
    <Dialog closeLabel={localize('Close', '关闭')} open onOpenChange={(open) => !open && onClose()} title={localize('New slide', '新建幻灯片')} className="w-[min(34rem,calc(100vw-2rem))]">
      <div role="listbox" aria-label={localize('Layouts', '版式')} className="mt-3 grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-1">
        {LAYOUT_IDS.map((layout, i) => (
          <button
            key={layout}
            type="button"
            role="option"
            aria-selected={false}
            autoFocus={i === 0}
            className="group flex flex-col gap-1.5 rounded-[8px] p-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => pick(layout)}
          >
            <span className="block overflow-hidden rounded-[4px] ring-1 ring-line group-hover:ring-line-strong">
              <LayoutPreview layout={layout} />
            </span>
            <span className="px-0.5 text-[13px] text-fg">{layoutName(layout, uiLocale())}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Scale                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Reads a scale entry: `150%`, `1.5x` / `×1.5`, or a width in px (`800px`,
 * `800`) relative to `width`. Returns the factor, or null.
 */
export function parseScale(text: string, width: number | null): number | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, '');
  let m = /^([\d.]+)%$/.exec(value);
  if (m) return Number(m[1]) / 100 || null;
  m = /^(?:[x×]([\d.]+)|([\d.]+)[x×])$/.exec(value);
  if (m) return Number(m[1] ?? m[2]) || null;
  m = /^([\d.]+)(?:px)?$/.exec(value);
  if (m && width) return Number(m[1]) / width || null;
  return null;
}

function ScaleDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { nodes } = useSelectedNodes();
  const rects = nodes.map(pinnedRectOf).filter((r) => r !== null);
  const width = rects.length === 1 ? rects[0]!.w : null;
  const [text, setText] = useState('100%');
  const factor = parseScale(text, width);
  const valid = factor !== null && factor > 0.01 && factor <= 20;
  const apply = (): void => {
    if (!valid) return;
    scaleSelection(factor);
    onClose();
  };
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open
      onOpenChange={(open) => !open && onClose()}
      title={localize('Scale', '缩放')}
      description={
        rects.length === 0
          ? localize('Select an element placed freely on the slide to scale it.', '请选择幻灯片上可以自由摆放的元素进行缩放。')
          : localize(`Scales ${rects.length === 1 ? 'the element' : `${rects.length} elements`} from the top-left corner, text included.`, `以左上角为基准缩放 ${rects.length} 个元素，文字也会一起缩放。`)
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {localize('Cancel', '取消')}
          </Button>
          <Button variant="primary" disabled={!valid || rects.length === 0} onClick={apply}>
            {localize('Scale', '缩放')}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {width ? localize('Percent, multiple or width', '百分比、倍数或宽度') : localize('Percent, multiple', '百分比或倍数')}
        <input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply();
          }}
          placeholder={width ? localize(`150%, 2x or ${Math.round(width)}px`, `150%、2 倍或 ${Math.round(width)} 像素`) : localize('150% or 2x', '150% 或 2 倍')}
          className={cn('h-8 rounded-control border bg-canvas px-2 text-[13px] text-fg outline-none focus:border-accent', valid || !text ? 'border-line' : 'border-danger')}
        />
      </label>
      {valid && width ? <p className="mt-2 text-xs text-fg-muted">{localize(`New width: ${Math.round(width * factor)} px`, `新宽度：${Math.round(width * factor)} 像素`)}</p> : null}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Video link                                                                  */
/* -------------------------------------------------------------------------- */

function VideoLinkDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { paths, nodes } = useSelectedNodes();
  const target = nodes.length === 1 && nodes[0]!.kind === 'image' ? paths[0] : undefined;
  const existing = target && nodes[0]!.kind === 'image' ? nodes[0]!.video?.link : undefined;
  const [text, setText] = useState('');
  const link = text.trim() ? parseVideoUrl(text.trim()) : null;
  const language = uiLocale();
  const providers = VIDEO_PROVIDERS.map((p) => videoProviderLabel(p, language)).join(localize(', ', '、'));
  const apply = (): void => {
    if (!link) return;
    if (insertVideoLink(text, target)) onClose();
  };
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open
      onOpenChange={(open) => !open && onClose()}
      title={existing ? localize('Change video link', '更改视频链接') : localize('Insert video link', '插入视频链接')}
      description={localize(`Paste a link from ${providers}. The video plays on the slide while presenting.`, `粘贴来自 ${providers} 的链接。放映时，视频将在幻灯片上播放。`)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {localize('Cancel', '取消')}
          </Button>
          <Button variant="primary" disabled={!link} onClick={apply}>
            {existing ? localize('Change', '更改') : localize('Insert', '插入')}
          </Button>
        </>
      }
    >
      <input
        autoFocus
        type="url"
        value={text}
        aria-label={localize('Video link', '视频链接')}
        placeholder="https://"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply();
        }}
        className={cn('h-8 w-full rounded-control border bg-canvas px-2 text-[13px] text-fg outline-none focus:border-accent', !text.trim() || link ? 'border-line' : 'border-danger')}
      />
      <p className="mt-2 min-h-4 text-xs text-fg-muted">
        {!text.trim() ? '' : link ? localize(`${videoProviderLabel(link.provider, language)} video${link.start ? `, from ${link.start}s` : ''}`, `${videoProviderLabel(link.provider, language)} 视频${link.start ? `，从 ${link.start} 秒开始播放` : ''}`) : localize("This link isn't a video this deck can play.", '此演示文稿无法播放链接中的视频。')}
      </p>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

/** Size of the hover picker. */
const PICKER = 8;

function TableDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const insert = (r: number, c: number): void => {
    insertTable(r, c);
    onClose();
  };
  const [shownR, shownC] = hover ?? [rows, cols];
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open
      onOpenChange={(open) => !open && onClose()}
      title={localize('Insert table', '插入表格')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {localize('Cancel', '取消')}
          </Button>
          <Button variant="primary" onClick={() => insert(rows, cols)}>
            {localize('Insert', '插入')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div role="grid" aria-label={localize('Table size', '表格大小')} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${PICKER}, 1.25rem)` }} onPointerLeave={() => setHover(null)}>
          {Array.from({ length: PICKER * PICKER }, (_, i) => {
            const r = Math.floor(i / PICKER) + 1;
            const c = (i % PICKER) + 1;
            const on = r <= shownR && c <= shownC;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${r} × ${c}`}
                className={cn('size-5 rounded-[3px] border', on ? 'border-accent bg-accent-soft' : 'border-line bg-canvas')}
                onPointerEnter={() => setHover([r, c])}
                onClick={() => insert(r, c)}
              />
            );
          })}
        </div>
        <div className="text-xs tabular-nums text-fg-muted">
          {shownR} × {shownC}
        </div>
        <div className="flex items-center gap-2">
          <NumberInput label={localize('Rows', '行数')} value={rows} min={1} max={LIMITS.tableRows} step={1} onCommit={(v) => v !== null && setRows(Math.round(v))} className="w-24" />
          <span className="text-fg-subtle">×</span>
          <NumberInput label={localize('Columns', '列数')} value={cols} min={1} max={LIMITS.tableColumns} step={1} onCommit={(v) => v !== null && setCols(Math.round(v))} className="w-24" />
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Shortcuts                                                                   */
/* -------------------------------------------------------------------------- */

const SHORTCUTS: ReadonlyArray<{ group: string; rows: ReadonlyArray<[string, string]> }> = [
  {
    group: localize('Slides', '幻灯片'),
    rows: [
      [`${MOD}M`, localize('New slide', '新建幻灯片')],
      [`${MOD}\\`, localize('Show or hide the properties panel', '显示或隐藏属性面板')],
      [`${MOD}D`, localize('Duplicate', '复制一份')],
      ['⌫', localize('Delete', '删除')],
      ['PgUp / PgDn', localize('Previous / next slide', '上一张／下一张幻灯片')],
      [`⌥${MOD}L`, localize("Copy the slide's link", '复制幻灯片链接')],
      [`${MOD}Enter / ⇧${MOD}Enter`, localize('Present from this slide / from the start', '从当前幻灯片／从头放映')],
    ],
  },
  {
    group: localize('Elements', '元素'),
    rows: [
      [`${MOD}A`, localize('Select all', '全选')],
      ['Tab / ⇧Tab', localize('Next / previous element', '下一个／上一个元素')],
      ['Enter / ⇧Enter', localize('Into a group or text / back out', '进入组合或编辑文字／退出')],
      [localize('Arrows', '方向键'), localize('Move 8 px (Shift: 1 px)', '移动 8 像素（按住 Shift 时移动 1 像素）')],
      [`${MOD}G / ⇧${MOD}G`, localize('Group / ungroup', '组合／取消组合')],
      ['] / [', localize('Bring to front / send to back', '置于顶层／置于底层')],
      ['⌥A ⌥H ⌥D', localize('Align left, horizontal centers, right', '左对齐、水平居中、右对齐')],
      ['⌥W ⌥V ⌥S', localize('Align top, vertical centers, bottom', '顶端对齐、垂直居中、底端对齐')],
      [`⌥${MOD}C / ⌥${MOD}V`, localize('Copy / paste style', '复制／粘贴样式')],
      ['K', localize('Scale…', '缩放…')],
      ['T R ⇧R O D L ⇧L', localize('Text, rectangle, rounded, ellipse, diamond, line, connector', '文本、矩形、圆角矩形、椭圆、菱形、直线、连接线')],
      ['Esc', localize('Cancel tool, end editing, clear selection', '取消工具、结束编辑、清除选区')],
    ],
  },
  {
    group: localize('View', '视图'),
    rows: [
      [`${MOD}F, ${MOD}G, F3`, localize('Find, next match', '查找、下一处匹配')],
      [`${MOD}= ${MOD}- ${MOD}0`, localize('Zoom in / out / fit', '放大／缩小／适应窗口')],
      ['C', localize('Comment mode', '评论模式')],
      ['F6', localize('Focus the formatting toolbar', '聚焦格式工具栏')],
      [`${MOD}Z / ⇧${MOD}Z`, localize('Undo / redo', '撤销／重做')],
      ['?', localize('Keyboard shortcuts', '键盘快捷键')],
    ],
  },
  {
    group: localize('Presenting', '放映'),
    rows: [
      [localize('→ ↓ Space', '→ ↓ 空格'), localize('Next build or slide', '下一个动画步骤或下一张幻灯片')],
      ['← ↑', localize('Previous', '上一步')],
      ['Home / End', localize('First / last slide', '第一张／最后一张幻灯片')],
      ['1–9', localize('Go to slide', '跳转到幻灯片')],
      ['F', localize('Full screen', '全屏')],
      ['Esc', localize('Stop presenting', '结束放映')],
    ],
  },
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  return (
    <Dialog closeLabel={localize('Close', '关闭')} open={open} onOpenChange={(next) => !next && onClose()} title={localize('Keyboard shortcuts', '键盘快捷键')} className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="grid max-h-[65vh] gap-5 overflow-y-auto sm:grid-cols-2">
        {SHORTCUTS.map(({ group, rows }) => (
          <section key={group}>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{group}</h3>
            <dl className="flex flex-col gap-1">
              {rows.map(([keys, action]) => (
                <div key={keys + action} className="flex items-baseline gap-3 text-xs">
                  <dt className="w-32 shrink-0 font-mono text-[11px] text-fg">{keys}</dt>
                  <dd className="text-fg-muted">{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Downloads                                                                   */
/* -------------------------------------------------------------------------- */

/** PDF options: picture quality and speaker notes. */
function PdfDialog(): ReactNode {
  const pdf = useExportUi((s) => s.pdf);
  const [quality, setQuality] = useState<PdfQuality>('better');
  const [notes, setNotes] = useState(false);
  const close = (): void => {
    if (pdf) session().shell?.exportState(pdf.request, 'declined');
    useExportUi.getState().closePdf();
  };
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open={pdf !== null}
      onOpenChange={(open) => !open && close()}
      title={localize('Download PDF', '下载 PDF')}
      description={localize('Each slide becomes a page with selectable, searchable text and working links.', '每张幻灯片导出为一页，文字可选择和搜索，链接可点击。')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {localize('Cancel', '取消')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!pdf) return;
              const { request } = pdf;
              useExportUi.getState().closePdf();
              void startExport({ format: 'pdf', quality, notes }, request);
            }}
          >
            {localize('Download', '下载')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">{localize('Picture quality', '图片质量')}</span>
          <Segmented<PdfQuality>
            value={quality}
            options={[
              { value: 'good', label: localize('Good', '良好') },
              { value: 'better', label: localize('Better', '较高') },
              { value: 'best', label: localize('Best', '最佳') },
            ]}
            onChange={setQuality}
          />
          <span className="text-[11px] text-fg-subtle">{localize('Higher quality makes a larger file.', '画质越高，文件越大。')}</span>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <SwitchInput checked={notes} onChange={setNotes} aria-label={localize('Include speaker notes', '包含演讲者备注')} />
          {localize('Include speaker notes', '包含演讲者备注')}
        </label>
      </div>
    </Dialog>
  );
}

/** Web page options: picture quality. */
function HtmlDialog(): ReactNode {
  const html = useExportUi((s) => s.html);
  const [quality, setQuality] = useState<HtmlQuality>('best');
  const close = (): void => {
    if (html) session().shell?.exportState(html.request, 'declined');
    useExportUi.getState().closeHtml();
  };
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open={html !== null}
      onOpenChange={(open) => !open && close()}
      title={localize('Download web page', '下载网页')}
      description={localize('One file that presents the deck in any browser, with builds, transitions and videos.', '导出为单个网页，可在浏览器中放映，支持动画步骤、切换效果和视频。')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {localize('Cancel', '取消')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!html) return;
              const { request } = html;
              useExportUi.getState().closeHtml();
              void startExport({ format: 'html', quality }, request);
            }}
          >
            {localize('Download', '下载')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">{localize('Picture quality', '图片质量')}</span>
        <Segmented<HtmlQuality>
          value={quality}
          options={[
            { value: 'good', label: localize('Good', '良好') },
            { value: 'better', label: localize('Better', '较高') },
            { value: 'best', label: localize('Best', '最佳') },
          ]}
          onChange={setQuality}
        />
        <span className="text-[11px] text-fg-subtle">{localize('Best keeps images as they are. Better and Good shrink large images to make a smaller file.', '最佳画质保留原图。较高和良好画质会缩小大图，以减小文件体积。')}</span>
      </div>
    </Dialog>
  );
}

/** "Only x of y slides so far": a download asked for while the agent is still writing the deck. */
function PartialExportDialog(): ReactNode {
  const partial = useExportUi((s) => s.partial);
  const written = partial?.progress.written ?? 0;
  const planned = partial?.progress.planned ?? 0;
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open={partial !== null}
      onOpenChange={(open) => !open && answerPartialExport(false)}
      title={localize('The deck is still being written', '演示文稿仍在制作中')}
      description={localize(`Only ${written} of ${planned} slides are written so far. The download will have just those.`, `计划制作 ${planned} 张幻灯片，已完成 ${written} 张。本次仅下载已完成的幻灯片。`)}
      footer={
        <>
          <Button variant="ghost" onClick={() => answerPartialExport(false)}>
            {localize('Cancel', '取消')}
          </Button>
          <Button variant="primary" onClick={() => answerPartialExport(true)}>
            {localize('Download anyway', '仍然下载')}
          </Button>
        </>
      }
    >
      <p className="text-xs text-fg-muted">{localize('Wait for the agent to finish to get every slide.', '等待 Agent 完成后，即可下载全部幻灯片。')}</p>
    </Dialog>
  );
}

/** What the last download could not carry over. */
function ExportNotesDialog(): ReactNode {
  const result = useExportUi((s) => s.notes);
  const close = (): void => useExportUi.getState().setNotes(null);
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open={result !== null}
      onOpenChange={(open) => !open && close()}
      title={result?.name ?? ''}
      description={result && !result.failed ? localize('Downloaded. A few things were adjusted on the way:', '下载完成。导出时做了以下调整：') : undefined}
      footer={
        <Button variant="primary" onClick={close}>
          {localize('OK', '确定')}
        </Button>
      }
    >
      <ul className="flex max-h-[50vh] list-disc flex-col gap-1 overflow-y-auto pl-5 text-xs text-fg-muted">
        {result?.notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </Dialog>
  );
}
