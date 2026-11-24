/**
 * Export notes: the things an export could not carry over, told to the
 * person once per kind with the slides they concern ("Embedded pages became
 * placeholder pictures (slides 3 and 7)."). Also the text wrapping used to
 * lay out speaker notes on PDF pages.
 */

/** Every kind of note about slides (or the whole deck), with its message. */
import { localize } from '@open-artifact/runtime';

export const NOTE_MESSAGES = {
  hidden: localize('Hidden slides were left out', '已略过隐藏的幻灯片'),
  held: localize('Slides with errors were left out', '已略过包含错误的幻灯片'),
  embed: localize('Embedded pages became still pictures', '嵌入网页已转为静态图片'),
  embedPdf: localize('Some embedded pages could not be captured and show as placeholders', '部分嵌入网页无法截图，已用占位内容代替'),
  video: localize('Videos became their poster pictures', '视频已替换为各自的封面图'),
  videoMissing: localize('Videos without a poster picture became placeholders', '无封面图的视频已替换为占位内容'),
  videoOnline: localize('Videos too large to include play from the deck online', '体积过大的视频未打包，将从在线演示文稿加载'),
  hostedVideo: localize('Hosted videos need an internet connection to play', '托管视频需要联网播放'),
  picture: localize('Some pictures could not be read and were left out', '部分图片无法读取，已略过'),
  pictureOnline: localize('Pictures too large to include load from the deck online', '体积过大的图片未打包，将从在线演示文稿加载'),
  notesCut: localize('Long speaker notes were cut to fit four pages', '过长的演讲者备注已截断至四页'),
  magic: localize('Magic Move transitions became fades', '「神奇移动」切换已改为淡入淡出'),
  builds: localize('Build animations were left out: everything shows from the start', '已省略分步动画，全部元素会立即显示'),
  rotatedTable: localize('Rotated tables were placed upright', '已恢复旋转表格的正向摆放'),
  listReversed: localize('Lists that count down were numbered upward (PowerPoint numbering only counts up)', '倒序列表已改为升序（PowerPoint 仅支持递增编号）'),
  listStart: localize('Lists that start below 1 were numbered from 1', '起始编号小于 1 的列表已从 1 开始编号'),
  listInside: localize('List markers set inside the text were hung in the margin', '行内列表标记已移到页边空白处'),
  backgroundPicture: localize('Backgrounds PowerPoint cannot draw (pictures, patterns, radial or see-through gradients) became pictures', 'PowerPoint 无法绘制的背景（图片、图案、径向渐变或含透明度的渐变）已转为图片'),
  polygonPicture: localize('Some clipped elements became pictures because their clipping could not be exported as editable geometry', '部分裁剪形状无法导出为可编辑图形，已转为图片'),
  textGradient: localize('Gradient-filled text took the gradient\u2019s first color (PowerPoint text here takes one color)', '渐变文字已改用渐变的第一种颜色（此处仅支持单色文字）'),
  shadowInset: localize('Inner shadows were left out (PowerPoint shapes carry outer shadows only)', '已省略内阴影（PowerPoint 形状仅支持外阴影）'),
  shadowLayers: localize('Only the first of several shadows on a shape was kept', '形状有多个阴影时，仅保留第一个'),
  shadowSpread: localize('Shadow spread was left out (PowerPoint shadows do not grow)', '已省略阴影扩展范围（PowerPoint 不支持此属性）'),
  borderDouble: localize('Double borders became single lines', '双线边框已改为单线'),
  borderSides: localize('Borders that differ from side to side became separate lines', '各边样式不同的边框已拆为单独的线条'),
  blend: localize('Blend modes were left out (PowerPoint has no equivalent)', '已省略混合模式（PowerPoint 无对应功能）'),
  filter: localize('Blur and color filters on boxes were left out', '已省略方框的模糊和颜色滤镜'),
  fontsLinked: localize('Fonts load from Google Fonts when the file is opened online', '联网打开文件时会从 Google Fonts 加载字体'),
  fontsMissing: localize('Some fonts could not be included, so a fallback font shows instead', '部分字体无法包含在文件中，显示时会使用替代字体'),
  fontsNotEmbedded: localize('Fonts are not embedded: PowerPoint uses installed fonts or substitutes', '字体未嵌入。PowerPoint 会使用已安装的字体或替代字体'),
  rasterFallback: localize('Some slides were drawn with a simpler renderer, so effects may differ', '部分幻灯片使用了简化渲染，效果可能有差异'),
  pageLimit: localize('The PDF reached its page limit, so the last slides were left out', '已达到 PDF 页数限制，末尾的幻灯片未导出'),
} as const;

export type NoteKind = keyof typeof NOTE_MESSAGES;

/** Kinds of note about font families (PowerPoint font embedding), with their message. */
export const FAMILY_NOTE_MESSAGES = {
  fontLicence: localize('Not embedded because their licenses do not allow it, so a substitute shows where they are not installed', '许可不允许嵌入，在未安装这些字体的设备上会使用替代字体'),
  fontVariable: localize('Not embedded because they are only published as variable fonts, which PowerPoint cannot embed', '这些字体仅发布了可变字体版本，PowerPoint 无法嵌入'),
  fontFormat: localize('Not embedded because their files are not TrueType, the only kind PowerPoint embeds', '这些字体并非 TrueType 格式，PowerPoint 仅支持嵌入 TrueType 字体'),
  fontBudget: localize('Not embedded because they would make the file too large', '嵌入这些字体会使文件过大，已略过'),
  fontBudgetAfter: localize('Not embedded because there was no room left after the fonts used by more of the text', '已优先嵌入使用较多的字体，剩余空间不足以嵌入这些字体'),
  fontFetch: localize('Not embedded because their files could not be downloaded', '无法下载这些字体文件，已略过'),
  fontSlow: localize('Not embedded because their files took too long to download; exporting again may carry them', '字体文件下载超时。重新导出后可能可以嵌入'),
  fontPartial: localize('Embedded for one script only: characters of other scripts show in a substitute font', '只嵌入了一种文字系统，其他文字会使用替代字体'),
  fontStyles: localize('Embedded without some of their bold or italic styles', '已嵌入字体，部分粗体或斜体样式未包含在内'),
  fontLate: localize('Had not finished loading when the slides were drawn, so some of their text may show in a fallback font; exporting again may help', '绘制幻灯片时字体仍在加载，部分文字可能使用替代字体。可尝试重新导出'),
} as const;

export type FamilyNoteKind = keyof typeof FAMILY_NOTE_MESSAGES;

/** "3", "3 and 7", "3, 5 and 7". */
export function slideList(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length <= 1) return String(sorted[0] ?? '');
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

/** "Inter", "Inter and Lora", "Inter, Lora and Mono". */
export function nameList(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/** Collects notes during one export. */
export class ExportNotes {
  private readonly kinds = new Map<NoteKind, number[]>();
  private readonly families = new Map<FamilyNoteKind, string[]>();
  private readonly extra: string[] = [];

  /** Records a note of a kind, for a slide (by its number in the deck) or the whole deck. */
  add(kind: NoteKind, slide?: number): void {
    const list = this.kinds.get(kind) ?? [];
    if (slide !== undefined) list.push(slide);
    this.kinds.set(kind, list);
  }

  /** Records a note about a font family. */
  family(kind: FamilyNoteKind, family: string): void {
    const list = this.families.get(kind) ?? [];
    if (!list.includes(family)) list.push(family);
    this.families.set(kind, list);
  }

  /** Records a free-form note (shown once). */
  text(message: string): void {
    if (!this.extra.includes(message)) this.extra.push(message);
  }

  has(kind: NoteKind): boolean {
    return this.kinds.has(kind);
  }

  /**
   * The notes as sentences: slide notes in the order of {@link NOTE_MESSAGES},
   * then font notes, then the rest. A family already named by another font
   * note is left out of `fontLate`: that note says more.
   */
  list(): string[] {
    const out: string[] = [];
    for (const kind of Object.keys(NOTE_MESSAGES) as NoteKind[]) {
      const slides = this.kinds.get(kind);
      if (!slides) continue;
      const unique = [...new Set(slides)];
      const where = unique.length === 0 ? '' : ` (${unique.length === 1 ? 'slide' : 'slides'} ${slideList(unique)})`;
      out.push(`${NOTE_MESSAGES[kind]}${where}.`);
    }
    const named = new Set([...this.families].flatMap(([kind, names]) => (kind === 'fontLate' ? [] : names)));
    for (const kind of Object.keys(FAMILY_NOTE_MESSAGES) as FamilyNoteKind[]) {
      const names = kind === 'fontLate' ? this.families.get(kind)?.filter((name) => !named.has(name)) : this.families.get(kind);
      if (!names?.length) continue;
      out.push(`${nameList(names)}: ${FAMILY_NOTE_MESSAGES[kind].charAt(0).toLowerCase()}${FAMILY_NOTE_MESSAGES[kind].slice(1)}.`);
    }
    return [...out, ...this.extra];
  }
}

/** True for characters a line may break before or after (CJK and similar). */
function breaksAnywhere(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}

/**
 * Wraps text into lines no wider than `width` as measured by `measure`.
 * Explicit line breaks are kept (an empty line stays empty); words longer
 * than a line are broken between characters; CJK text breaks anywhere.
 */
export function wrapLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Tokens: runs of non-space (split further where CJK allows) with their trailing spaces.
    const tokens: string[] = [];
    for (const match of paragraph.matchAll(/\s*\S+\s*|\s+/g)) {
      let word = '';
      for (const char of match[0]) {
        if (breaksAnywhere(char)) {
          if (word) tokens.push(word);
          tokens.push(char);
          word = '';
        } else word += char;
      }
      if (word) tokens.push(word);
    }
    let line = '';
    const push = (): void => {
      lines.push(line.trimEnd());
      line = '';
    };
    for (const token of tokens) {
      const candidate = line + token;
      if (measure(candidate.trimEnd()) <= width) {
        line = candidate;
        continue;
      }
      // Start a new line (a line of only spaces is dropped).
      if (line.trim()) push();
      line = '';
      const rest = token.trimStart();
      if (measure(rest.trimEnd()) <= width) {
        line = rest;
        continue;
      }
      // A token longer than a whole line: break it between characters.
      for (const char of rest) {
        if (line && measure((line + char).trimEnd()) > width) push();
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Lines split into pages, and whether some were left over. */
export interface NotePages {
  pages: string[][];
  /** More lines than `maxPages` could hold. */
  cut: boolean;
}

/**
 * Splits wrapped lines into pages: `firstLines` fit on the first page,
 * `perPage` on each later one, at most `maxPages` pages. Trailing empty
 * lines are dropped.
 */
export function paginate(lines: readonly string[], firstLines: number, perPage: number, maxPages: number): NotePages {
  let end = lines.length;
  while (end > 0 && !lines[end - 1]!.trim()) end--;
  const pages: string[][] = [];
  let at = 0;
  while (at < end && pages.length < maxPages) {
    const take = pages.length === 0 ? firstLines : perPage;
    pages.push(lines.slice(at, Math.min(end, at + take)));
    at += take;
  }
  return { pages, cut: at < end };
}
