/**
 * Element-specific sections of the properties panel: image / video, table,
 * embed, connector, line and icon.
 */

import { localize, uiLocale } from '@open-artifact/runtime';
import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Ban, Minus, Upload } from 'lucide-react';
import {
  CORNERS,
  ICON_NAMES,
  LIMITS,
  videoProviderLabel,
  formatBorder,
  hasHeaderRow,
  parseBorder,
  resizeTable,
  rgbaToHex,
  setHeaderRow,
  setImageCrop,
  setImageFit,
  setImageSource,
  setVideo,
  tableColumns,
  updateNodeAt,
  videoKeepsStart,
  type ConnectorNode,
  type Corner,
  type HeadKind,
  type IconName,
  type ImageNode,
  type NodePath,
  type Route,
  type SlideNode,
  type TableNode,
  type VideoSpec,
} from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ColorRow, useColorGroups } from './ColorField.tsx';
import { StrokeDashedIcon, StrokeDottedIcon, StrokeSolidIcon } from './icons.tsx';
import { CheckboxInput, IconButton, Note, NumberInput, Row, Section, Segmented, SelectInput, SwitchInput, TextInput } from './kit.tsx';
import { ICON_GLYPHS } from '../../render/icons.tsx';
import { useUi } from '../../state/ui.ts';
import { changeCurrent, updateSelection } from '../../services/commands.ts';
import { pickFiles, posterFromClip, posterFromSite, replaceImage, replacePoster } from '../../services/assets.ts';
import { resolveSrc } from '../../services/session.ts';
import { colorsAt, commitCss, contrastFor, sharedStyle, type Target } from './shared.tsx';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mov';

/** Applies `fn` to the single image at `path`. */
function updateImage(path: NodePath, label: string, fn: (node: ImageNode) => ImageNode, coalesce?: string): void {
  changeCurrent(label, (slide) => updateNodeAt(slide, path, (node) => (node.kind === 'image' ? fn(node) : node)), coalesce ? { coalesce } : {});
}

/** Applies `fn` to every selected image. */
function updateImages(label: string, fn: (node: ImageNode) => ImageNode, coalesce?: string): void {
  updateSelection(label, (node) => (node.kind === 'image' ? fn(node) : node), coalesce ? { coalesce } : undefined);
}

/** True when `node` shows a picture or a clip. */
function hasMedia(node: ImageNode): boolean {
  return Boolean(node.src || node.video);
}

/** Removes the picture and any clip, leaving an empty frame. */
function clearMedia(node: ImageNode): ImageNode {
  return setImageSource(setVideo(node, null), undefined);
}

/* -------------------------------------------------------------------------- */
/* Media source row                                                            */
/* -------------------------------------------------------------------------- */

interface MediaSourceRowProps {
  label: string;
  /** What the field says: the picture's name, "Mixed", or "Add image…" when empty. */
  text: string;
  /** A thumbnail of the picture (not for clips). */
  thumb?: string;
  empty?: boolean;
  /** Why the field can't be used. */
  reason?: string;
  /** Tooltip of the field when it can be used. */
  tip: string;
  onPress: () => void;
  removeLabel?: string;
  onRemove?: () => void;
}

/**
 * A row naming a picture (or clip, or cover): pressing it picks a
 * replacement; the trailing button removes it or, when empty, uploads one.
 */
function MediaSourceRow({ label, text, thumb, empty = false, reason, tip, onPress, removeLabel, onRemove }: MediaSourceRowProps): ReactNode {
  const disabled = reason !== undefined;
  return (
    <Row label={label}>
      <button
        type="button"
        aria-label={empty ? `${label}: none` : `${label}: ${text}`}
        title={reason ?? (empty ? undefined : tip)}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onPress}
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-chrome-field px-1.5 text-left text-[13px] text-chrome-fg outline-none hover:bg-chrome-hover focus-visible:ring-1 focus-visible:ring-chrome-accent',
          disabled && 'cursor-default text-chrome-muted hover:bg-chrome-field',
          empty && 'text-chrome-muted',
        )}
      >
        {!empty && thumb !== undefined ? (
          <span className="size-[18px] shrink-0 overflow-hidden rounded-[4px] border border-chrome-sep bg-chrome">
            {thumb ? <img alt="" src={thumb} className="size-full object-cover" /> : null}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </button>
      {empty ? (
        <IconButton label={localize('Upload image…', '上传图片…')} icon={<Upload className="size-3.5" />} disabled={disabled} reason={reason} onClick={onPress} />
      ) : onRemove ? (
        <IconButton label={removeLabel ?? localize('Remove', '移除')} icon={<Minus className="size-3.5" />} onClick={onRemove} />
      ) : null}
    </Row>
  );
}

/** A file-name-like alt text names the picture best. */
function looksLikeFilename(text: string): boolean {
  return /^[^\s/\\]+\.(png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i.test(text.trim());
}

/** What the source row calls the picture or clip. */
function mediaName(node: ImageNode): string {
  const alt = node.alt?.trim() ?? '';
  if (looksLikeFilename(alt)) return alt;
  if (node.video?.link) {
    const provider = videoProviderLabel(node.video.link.provider, uiLocale());
    return localize(`${provider} video`, `${provider} 视频`);
  }
  if (node.video) return localize('Uploaded video', '已上传的视频');
  const file = node.src && !node.src.startsWith('/_blob/') ? node.src.split('/').pop() : undefined;
  if (file) return decodeURIComponent(file);
  const ext = /\.([a-z0-9]+)$/i.exec(node.src ?? '')?.[1];
  return ext ? localize(`${ext.toUpperCase()} image`, `${ext.toUpperCase()} 图片`) : localize('Image', '图片');
}

/* -------------------------------------------------------------------------- */
/* Image / video                                                               */
/* -------------------------------------------------------------------------- */

const SVG_FIT_REASON = localize("A selected SVG image can't be cropped to fill its frame.", '所选 SVG 图片无法裁剪以填满边框。');

/** An image or video frame: its source, cover, fit, playback and alt text. */
export function ImageSection({ target }: { target: Target }): ReactNode {
  if (target.nodes.length === 0 || !target.nodes.every((n) => n.kind === 'image')) return null;
  const images = target.nodes as ImageNode[];
  const single = images.length === 1;
  const node = images[0]!;
  const path = target.paths[0]!;
  const video = single ? node.video : undefined;
  const empty = !images.some(hasMedia);
  const isSvg = images.some((n) => /\.svg($|\?)/i.test(n.src ?? ''));
  const fits = images.map((n) => (n.style['object-fit'] === 'contain' ? 'contain' : 'cover'));
  const fit = fits.every((f) => f === fits[0]) ? fits[0]! : null;
  const alts = images.map((n) => n.alt ?? '');
  const sameAlt = alts.every((a) => a === alts[0]);

  const pick = (accept: string, then: (file: File) => void): void => {
    void pickFiles(accept, false).then((files) => {
      if (files[0]) then(files[0]);
    });
  };
  const onPress = (): void => {
    if (video?.link) useUi.getState().open('videoLink');
    else pick(video ? `${VIDEO_ACCEPT},${IMAGE_ACCEPT}` : IMAGE_ACCEPT, (file) => void replaceImage(path, file));
  };

  return (
    <Section title={video ? localize('Video', '视频') : localize('Image', '图片')}>
      <MediaSourceRow
        label={video ? localize('Video', '视频') : localize('Image', '图片')}
        text={!single ? localize('Mixed', '混合值') : empty ? localize('Add image…', '添加图片…') : mediaName(node)}
        thumb={video || !node.src ? undefined : resolveSrc(node.src)}
        empty={empty}
        reason={single ? undefined : localize('Select one image to replace it', '选择一张图片进行替换')}
        tip={video?.link ? localize('Change video link', '更改视频链接') : video ? localize('Replace the video…', '替换视频…') : localize('Replace the image…', '替换图片…')}
        onPress={onPress}
        removeLabel={video ? localize('Remove video', '移除视频') : localize('Remove image', '移除图片')}
        onRemove={() => updateImages(video ? localize('Remove video', '移除视频') : localize('Remove image', '移除图片'), clearMedia)}
      />
      {video ? <CoverRow node={node} path={path} video={video} /> : null}
      {video?.link && !node.src ? null : (
        <Row label={localize('Fit', '适应方式')}>
          <Segmented<'cover' | 'contain'>
            aria-label={localize('Image fit', '图片适应方式')}
            value={fit}
            options={[
              { value: 'cover', label: localize('Cover', '填满'), ...(isSvg ? { disabled: true, reason: SVG_FIT_REASON } : {}) },
              { value: 'contain', label: localize('Contain', '完整显示') },
            ]}
            onChange={(value) => updateImages(localize('Image fit', '图片适应方式'), (n) => (value === 'cover' && /\.svg($|\?)/i.test(n.src ?? '') ? n : setImageFit(value === 'contain' ? setImageCrop(n, undefined) : n, value)))}
          />
        </Row>
      )}
      {video ? <PlaybackRows path={path} video={video} /> : null}
      <Row label={localize('Alt text', '替代文本')}>
        <TextInput
          aria-label={localize('Alt text', '替代文本')}
          className="min-w-0 flex-1"
          maxLength={LIMITS.alt}
          value={sameAlt ? alts[0]! : ''}
          placeholder={sameAlt ? '' : localize('Mixed', '混合值')}
          onChange={(event) => {
            const alt = event.target.value;
            updateImages(localize('Alt text', '替代文本'), (n) => setImageSource(n, n.src, alt), 'alt-text');
          }}
        />
      </Row>
    </Section>
  );
}

/** The cover image of a clip: a frame, the site's thumbnail, or a custom picture. */
function CoverRow({ node, path, video }: { node: ImageNode; path: NodePath; video: VideoSpec }): ReactNode {
  const custom = video.still === 'custom';
  const provider = video.link ? videoProviderLabel(video.link.provider, uiLocale()) : '';
  const name = custom ? localize('Custom cover image', '自定义封面图') : !node.src ? localize('None', '无') : provider ? localize(`${provider} thumbnail`, `${provider} 缩略图`) : localize('Video frame', '视频帧');
  return (
    <MediaSourceRow
      label={localize('Cover image', '封面图')}
      text={name}
      thumb={node.src ? resolveSrc(node.src) : ''}
      tip={localize('Set cover image', '设置封面图')}
      onPress={() => {
        void pickFiles(IMAGE_ACCEPT, false).then((files) => {
          if (files[0]) void replacePoster(path, files[0]);
        });
      }}
      removeLabel={localize('Reset cover image', '重置封面图')}
      onRemove={custom ? () => void (video.link ? posterFromSite(path) : posterFromClip(path)) : undefined}
    />
  );
}

/** How a clip plays while presenting. */
function PlaybackRows({ path, video }: { path: NodePath; video: VideoSpec }): ReactNode {
  const set = (label: string, patch: Partial<VideoSpec>, coalesce?: string): void => updateImage(path, label, (n) => setVideo(n, patch), coalesce);
  const onClick = Boolean(video.startOnClick);
  return (
    <>
      <Row label={localize('Autoplay', '自动播放')} tip={localize('Automatically starts the video when it appears in a presentation.', '放映时，视频出现后会自动播放。')}>
        <SwitchInput aria-label={localize('Autoplay', '自动播放')} checked={!onClick} onChange={(on) => set(localize('Video autoplay', '视频自动播放'), on ? { startOnClick: undefined } : { startOnClick: true, delay: undefined })} />
      </Row>
      <Row label={localize('Delay', '延迟')}>
        <NumberInput
          aria-label={localize('Delay', '延迟')}
          value={onClick ? null : (video.delay ?? 0)}
          unit="s"
          min={0}
          max={60}
          step={0.5}
          disabled={onClick}
          title={onClick ? localize('A video that starts on a click has no delay.', '点击播放的视频无需设置延迟。') : localize('Seconds to wait after the slide appears before the video starts.', '幻灯片出现后，等待多少秒再播放视频。')}
          onCommit={(v) => set(localize('Video delay', '视频播放延迟'), { delay: v ? Math.min(60, v) : undefined }, 'video-delay')}
        />
      </Row>
      {video.src ? (
        <>
          <Row label={localize('Loop', '循环播放')}>
            <SwitchInput aria-label={localize('Loop', '循环播放')} checked={video.loop !== false} onChange={(on) => set(localize('Video loop', '视频循环播放'), { loop: on ? undefined : false })} />
          </Row>
          <Row label={localize('Sound', '声音')}>
            <SwitchInput aria-label={localize('Sound', '声音')} checked={Boolean(video.sound)} onChange={(on) => set(localize('Video sound', '视频声音'), { sound: on || undefined })} />
          </Row>
        </>
      ) : null}
      {video.link && videoKeepsStart(video.link.provider) ? (
        <Row label={localize('Start at', '起始时间')} tip={localize('Seconds into the video where it starts playing.', '从视频的第几秒开始播放。')}>
          <NumberInput
            aria-label={localize('Start at', '起始时间')}
            value={video.link.start ?? 0}
            unit="s"
            min={0}
            max={86_400}
            onCommit={(v) => set(localize('Video start time', '视频起始时间'), { link: { ...video.link!, start: v ? Math.round(v) : undefined } })}
          />
        </Row>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

/** Applies `fn` to the single table at `path`. */
/** Changes one table on the current slide (the panel and the floating strip). */
export function updateTable(path: NodePath, label: string, fn: (table: TableNode) => TableNode): void {
  changeCurrent(label, (slide) => updateNodeAt(slide, path, (node) => (node.kind === 'table' ? fn(node) : node)));
}

/** Sets one column's width (percent of the table) on the first row's cell; null makes it auto. */
function setColumnWidth(table: TableNode, col: number, percent: number | null): TableNode {
  return {
    ...table,
    rows: table.rows.map((row, r) =>
      r === 0
        ? {
            ...row,
            cells: row.cells.map((cell, c) => {
              if (c !== col) return cell;
              const style = { ...cell.style };
              if (percent === null) delete style.width;
              else style.width = `${percent}%`;
              return { ...cell, style };
            }),
          }
        : row,
    ),
  };
}

/** A table: columns, rows, column widths and the header row. */
export function TableSection({ target }: { target: Target }): ReactNode {
  const table = target.nodes.length === 1 && target.nodes[0]!.kind === 'table' ? (target.nodes[0] as TableNode) : null;
  if (!table) return null;
  const path = target.paths[0]!;
  const rows = table.rows.length;
  const cols = tableColumns(table);
  const widths = Array.from({ length: cols }, (_, c) => {
    const width = table.rows[0]?.cells[c]?.style.width;
    const percent = width ? /^([\d.]+)%$/.exec(width) : null;
    return { value: percent ? Number(percent[1]) : null, placeholder: width && !percent ? width : 'auto' };
  });

  return (
    <Section title={localize('Table', '表格')}>
      <Row label={localize('Columns', '列数')}>
        <NumberInput aria-label={localize('Columns', '列数')} value={cols} min={1} max={LIMITS.tableColumns} onCommit={(v) => v && v !== cols && updateTable(path, localize('Table columns', '表格列数'), (t) => resizeTable(t, rows, v))} />
      </Row>
      <Row label={localize('Rows', '行数')}>
        <NumberInput aria-label={localize('Rows', '行数')} value={rows} min={1} max={LIMITS.tableRows} onCommit={(v) => v && v !== rows && updateTable(path, localize('Table rows', '表格行数'), (t) => resizeTable(t, v, cols))} />
      </Row>
      <div className="flex flex-col gap-1 py-1 pl-4 pr-3">
        <div className="text-[12px] text-chrome-muted">{localize('Column widths', '列宽')}</div>
        <div className="grid grid-cols-2 gap-2">
          {widths.map((width, c) => (
            <NumberInput
              key={c}
              aria-label={localize(`Column ${c + 1} width`, `第 ${c + 1} 列的宽度`)}
              label={localize(`Col ${c + 1}`, `第 ${c + 1} 列`)}
              value={width.value}
              placeholder={width.placeholder}
              min={1}
              max={100}
              steppers={false}
              //.
              className="[&_input]:placeholder:text-chrome-fg"
              onCommit={(v) => updateTable(path, localize('Column width', '列宽'), (t) => setColumnWidth(t, c, v))}
            />
          ))}
        </div>
      </div>
      <Row label={localize('Header row', '表头行')}>
        <CheckboxInput aria-label={localize('Header row', '表头行')} checked={hasHeaderRow(table)} onChange={(on) => updateTable(path, on ? localize('Add header row', '添加表头行') : localize('Remove header row', '移除表头行'), (t) => setHeaderRow(t, on))} />
      </Row>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Embed                                                                       */
/* -------------------------------------------------------------------------- */

/** An embed: what can (not) be changed here. */
export function EmbedSection({ target }: { target: Target }): ReactNode {
  if (target.nodes.length !== 1 || target.nodes[0]!.kind !== 'embed') return null;
  return (
    <Section title={localize('Embed', '嵌入内容')}>
      <Note>{localize('This embed’s content is written by the agent — ask the agent in chat to change it.', '此嵌入内容由 Agent 编写。要修改，请在对话中告诉它。')}</Note>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Connector                                                                   */
/* -------------------------------------------------------------------------- */

const DIRECTIONS: Record<Corner, { label: string; Icon: typeof ArrowDownRight }> = {
  tl: { label: localize('Down-right', '右下'), Icon: ArrowDownRight },
  tr: { label: localize('Down-left', '左下'), Icon: ArrowDownLeft },
  bl: { label: localize('Up-right', '右上'), Icon: ArrowUpRight },
  br: { label: localize('Up-left', '左上'), Icon: ArrowUpLeft },
};

const HEAD_OPTIONS: { value: HeadKind; label: string }[] = [
  { value: 'none', label: localize('None', '无') },
  { value: 'open', label: localize('Open', '空心') },
  { value: 'filled', label: localize('Filled', '实心') },
];

const ROUTE_OPTIONS: { value: Route; label: string }[] = [
  { value: 'straight', label: localize('Straight', '直线') },
  { value: 'elbow', label: localize('Elbow', '折线') },
  { value: 'hv', label: localize('Bend: across, then down', '折线：先横向，再纵向') },
  { value: 'vh', label: localize('Bend: down, then across', '折线：先纵向，再横向') },
];

/** One value when every connector agrees, else null (mixed). */
function sharedField<K extends keyof ConnectorNode>(nodes: ConnectorNode[], key: K, fallback: NonNullable<ConnectorNode[K]>): NonNullable<ConnectorNode[K]> | null {
  const values = nodes.map((n) => n[key] ?? fallback);
  return values.every((v) => v === values[0]) ? (values[0] as NonNullable<ConnectorNode[K]>) : null;
}

function setConnector(label: string, patch: Partial<ConnectorNode>): void {
  updateSelection(label, (node) => (node.kind === 'connector' ? ({ ...node, ...patch } as SlideNode) : node));
}

/** A connector: direction, arrowheads, route and dash; then its line's look. */
export function ConnectorSection({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  if (target.nodes.length === 0 || !target.nodes.every((n) => n.kind === 'connector')) return null;
  const nodes = target.nodes as ConnectorNode[];
  const flow = nodes.every((n) => !n.points);
  const style = sharedStyle(target, 'border-style');
  const width = sharedStyle(target, 'border-width');
  const color = sharedStyle(target, 'color');
  const dash = style.mixed ? null : style.value === 'dashed' ? 'dashed' : 'solid';
  const setDash = (value: string): void => {
    commitCss(target, 'border-style', value === 'dashed' ? 'dashed' : '', localize('Line style', '线型'));
  };
  return (
    <>
      <Section title={localize('Connector', '连接线')}>
        {flow ? (
          <Row label={localize('Direction', '方向')}>
            <Segmented<Corner>
              aria-label={localize('Direction', '方向')}
              value={sharedField(nodes, 'from', 'tl')}
              options={CORNERS.map((corner) => {
                const { label, Icon } = DIRECTIONS[corner];
                return { value: corner, title: label, label: <Icon className="size-4" strokeWidth={1.5} /> };
              })}
              onChange={(corner) => updateSelection(localize('Connector direction', '连接线方向'), (node) => {
                if (node.kind !== 'connector') return node;
                const { from: _from, ...rest } = node;
                return corner === 'tl' ? rest : { ...rest, from: corner };
              })}
            />
          </Row>
        ) : null}
        <Row label={localize('Start', '起点')}>
          <Segmented<HeadKind> aria-label={localize('Start', '起点')} value={sharedField(nodes, 'headStart', 'none')} options={HEAD_OPTIONS} onChange={(head) => setConnector(localize('Arrowhead', '箭头'), { headStart: head })} />
        </Row>
        <Row label={localize('End', '终点')}>
          <Segmented<HeadKind> aria-label={localize('End', '终点')} value={sharedField(nodes, 'headEnd', 'none')} options={HEAD_OPTIONS} onChange={(head) => setConnector(localize('Arrowhead', '箭头'), { headEnd: head })} />
        </Row>
        <Row label={localize('Route', '路径')}>
          <SelectInput<Route> aria-label={localize('Route', '路径')} value={sharedField(nodes, 'route', 'straight')} placeholder={localize('Mixed', '混合值')} options={ROUTE_OPTIONS} onChange={(route) => setConnector(localize('Connector route', '连接线路径'), { route })} />
        </Row>
        <Row label={localize('Style', '样式')}>
          <Segmented<'solid' | 'dashed'>
            aria-label={localize('Style', '样式')}
            value={dash}
            options={[
              { value: 'solid', label: localize('Solid', '实线') },
              { value: 'dashed', label: localize('Dashed', '虚线') },
            ]}
            onChange={setDash}
          />
        </Row>
      </Section>
      <Section title={localize('Appearance', '外观')}>
        <Row label={localize('Line', '直线')}>
          <Segmented<'none' | 'solid' | 'dashed' | 'dotted'>
            aria-label={localize('Line', '直线')}
            value={dash}
            options={[
              { value: 'none', title: localize('None', '无'), label: <Ban className="size-3.5" strokeWidth={1.5} />, disabled: true, reason: localize('A line always draws', '直线必须显示线条') },
              { value: 'solid', title: localize('Solid', '实线'), label: <StrokeSolidIcon /> },
              { value: 'dashed', title: localize('Dashed', '虚线'), label: <StrokeDashedIcon /> },
              { value: 'dotted', title: localize('Dotted', '点线'), label: <StrokeDottedIcon />, disabled: true, reason: localize('A line is solid or dashed', '直线支持实线或虚线') },
            ]}
            onChange={setDash}
          />
        </Row>
        <ColorRow
          label={localize('Color', '颜色')}
          aria-label={localize('Line color', '线条颜色')}
          value={color.mixed ? null : (color.value ?? null)}
          mixed={color.mixed}
          effective={rgbaToHex(colorsAt(target.slide, target.paths[0]!).text)}
          emptyLabel={localize('Theme default', '主题默认')}
          groups={groups}
          onReset={color.value ? () => commitCss(target, 'color', '', localize('Line color', '线条颜色')) : undefined}
          onCommit={(value) => commitCss(target, 'color', value ?? '', localize('Line color', '线条颜色'), 'line-color')}
        />
        <Row label={localize('Width', '宽度')}>
          <NumberInput
            aria-label={localize('Line width', '线宽')}
            value={width.mixed ? null : (Number.parseFloat(width.value ?? '') || null)}
            placeholder={width.mixed ? localize('Mixed', '混合值') : '2'}
            unit="px"
            min={1}
            max={32}
            onCommit={(v) => commitCss(target, 'border-width', v ? `${v}px` : '', localize('Line width', '线宽'), 'line-width')}
          />
        </Row>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Line                                                                        */
/* -------------------------------------------------------------------------- */

/** A line shape or `<hr>`: thickness and color (lines are solid). */
export function LineSection({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  const isLine = (n: SlideNode): boolean => n.kind === 'rule' || (n.kind === 'shape' && n.shape === 'line');
  if (target.nodes.length === 0 || !target.nodes.every(isLine)) return null;
  const shared = sharedStyle(target, 'border');
  const parsed = shared.value && !shared.mixed ? parseBorder(shared.value, 32) : null;
  const border = parsed?.ok ? parsed.value : { width: 2, style: 'solid' as const, color: '#141413' };
  const commit = (patch: Partial<typeof border>, label: string): void => {
    commitCss(target, 'border', formatBorder({ ...border, ...patch, style: 'solid' }), label, 'line');
  };
  return (
    <Section title={localize('Line', '直线')}>
      <Row label={localize('Thickness', '粗细')}>
        <NumberInput aria-label={localize('Thickness', '粗细')} value={shared.mixed ? null : border.width} placeholder={localize('Mixed', '混合值')} unit="px" min={1} max={32} onCommit={(v) => commit({ width: v ?? 2 }, localize('Line thickness', '线条粗细'))} />
      </Row>
      <ColorRow label={localize('Color', '颜色')} aria-label={localize('Line color', '线条颜色')} value={shared.mixed ? null : border.color} mixed={shared.mixed} groups={groups} onCommit={(color) => color && commit({ color }, localize('Line color', '线条颜色'))} />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Icon                                                                        */
/* -------------------------------------------------------------------------- */

/** "CheckCircle" → "Check circle". */
function iconLabel(name: IconName): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words[0]!.toUpperCase() + words.slice(1);
}

/** An icon: its glyph and its color. */
export function IconSection({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  if (target.nodes.length === 0 || !target.nodes.every((n) => n.kind === 'icon')) return null;
  const names = target.nodes.map((n) => (n.kind === 'icon' ? n.name : null));
  const glyph = names.every((n) => n === names[0]) ? names[0]! : null;
  const color = sharedStyle(target, 'color');
  const value = color.mixed ? null : (color.value ?? null);
  const effective = rgbaToHex(colorsAt(target.slide, target.paths[0]!).text);
  return (
    <Section title={localize('Icon', '图标')}>
      <Row label={localize('Glyph', '图形')}>
          <SelectInput<IconName>
            aria-label={localize('Glyph', '图形')}
            value={glyph}
            placeholder={localize('Mixed', '混合值')}
            options={ICON_NAMES.map((name) => {
              const Glyph = ICON_GLYPHS[name];
              return { value: name, label: iconLabel(name), icon: <Glyph size={14} strokeWidth={1.75} /> };
            })}
            onChange={(name) => updateSelection(localize('Icon', '图标'), (node) => (node.kind === 'icon' ? { ...node, name } : node))}
          />
        </Row>
      <ColorRow
        label={localize('Color', '颜色')}
        aria-label={localize('Icon color', '图标颜色')}
        value={value}
        mixed={color.mixed}
        effective={effective}
        emptyLabel={localize('Theme default', '主题默认')}
        groups={groups}
        contrast={color.mixed ? null : contrastFor(target, { kind: 'icon', color: value ?? effective })}
        onReset={value ? () => commitCss(target, 'color', '', localize('Icon color', '图标颜色')) : undefined}
        onCommit={(next) => commitCss(target, 'color', next ?? '', localize('Icon color', '图标颜色'), 'icon-color')}
      />
    </Section>
  );
}
