// The nine built-in artifact types, as the site shows them. Every claim here is taken from
// docs/types/<type>.md (and its .zh-CN.md pair), artifact-types/<type>/artifact-type.json (exports) and
// packages/library-page/src/look.tsx (colors, beta flags). Keep it in step with those files.

const SHARED_TAIL = `├── _blobs/            # uploads, content-addressed
├── comments.json
└── history/`;

export const TYPES = [
  {
    id: 'slides',
    name: 'Slides',
    colors: { wash: '#f7d9ca', ink: '#903710', tint: '#e8703a' },
    beta: false,
    usesDS: true,
    exports: ['PDF', 'PPTX', 'HTML', 'PNG'],
    tagline: {
      en: '1920×1080 or 4:3 decks with speaker notes, builds, transitions and a full-screen presenter.',
      zh: '1920×1080 或 4:3 的演示文稿，带演讲者备注、逐项动画、转场和全屏演示。',
    },
    summary: {
      en: 'Editable 16:9 or 4:3 presentation decks stored as plain local HTML, CSS and JSON files. For pitch decks, talks, product reviews and training decks you arrange, edit in place, rehearse with speaker notes, present full screen and export.',
      zh: '可编辑的 16:9 或 4:3 演示文稿，以普通的本地 HTML、CSS 和 JSON 文件保存。适合融资推介、技术分享、产品评审和培训课件：编排顺序、直接改字、配演讲者备注、全屏演示，再导出。',
    },
    features: [
      { en: ['Edit slides directly', 'Retype text, move and resize elements, tweak type and colors, reorder slides in the rail or the section overview.'], zh: ['直接改幻灯片', '直接改文案、移动和缩放元素、调整字体与配色，在幻灯片栏或章节总览里拖拽排序。'] },
      { en: ['Sections and outline', 'Group slides into named sections with a one-line description, all visible in the overview grid.'], zh: ['章节与大纲', '按章节组织幻灯片，每个章节一句话说明，在总览网格里一目了然。'] },
      { en: ['Notes, builds, transitions', 'Per-slide speaker notes, step-by-step element builds and slide transitions.'], zh: ['备注、逐项动画、转场', '每页独立的演讲者备注、分步出现的动画和切页转场。'] },
      { en: ['Presenter mode', 'Present full screen from the browser with keyboard navigation and your notes.'], zh: ['演示模式', '直接在浏览器全屏放映，键盘翻页，看得到演讲者备注。'] },
      { en: ['Polygon picture frames', 'clip-path polygons on panels and photos; simple ones export as editable PowerPoint shapes and pictures.'], zh: ['多边形相框', '面板和照片可用多边形裁剪；简单的会导出为可编辑的 PowerPoint 形状和图片。'] },
      { en: ['On brand', 'Install a Design System and its colors, text styles and fonts show up in the editor pickers.'], zh: ['保持品牌一致', '安装设计系统后，品牌颜色、文字样式和字体会出现在编辑器的选择器里。'] },
    ],
    tree: `my-deck/
├── project/
│   ├── deck.json       # title, slide order, sections, typefaces
│   ├── deck.css        # shared variables and layout classes
│   ├── slides/
│   │   ├── cover.html  # one <section> per slide (+ <aside> notes)
│   │   └── problem.html
│   └── ds/acme/        # an installed design system (optional)
${SHARED_TAIL}`,
    prompts: {
      en: ['/open-artifact slides a 6-slide investor pitch for our developer tool', '/open-artifact slides a 10-slide Q3 engineering review in 4:3 using our Acme design system'],
      zh: ['/open-artifact slides 为我们的开发者工具做一个 6 页投资人推介 PPT', '/open-artifact slides 用 Acme 设计系统做一份 10 页的 Q3 研发复盘（4:3 比例）'],
    },
  },
  {
    id: 'design',
    name: 'Design',
    colors: { wash: '#e4deff', ink: '#5437b8', tint: '#7a5cf0' },
    beta: false,
    usesDS: true,
    exports: ['PNG', 'JPEG', 'PDF', 'HTML'],
    tagline: {
      en: 'An infinite WebGL2 canvas of live HTML artboards, Play-mode prototypes, responsive previews and print layouts.',
      zh: 'WebGL2 无限画布上的实时 HTML 画板，带 Play 模式原型、响应式预览和打印排版。',
    },
    summary: {
      en: 'An infinite, WebGL2-accelerated canvas of live .dc.html artboards saved as local files. For UI screens, landing page explorations, side-by-side options, clickable prototypes, diagrams, posters and print layouts.',
      zh: '由 WebGL2 驱动的无限画布，承载以本地文件保存的实时 .dc.html 画板。适合 UI 界面、落地页方案对比、可点击原型、图表、海报和印刷排版。',
    },
    features: [
      { en: ['Infinite multi-page canvas', 'Artboards side by side across up to 40 pages, with section titles, notes, shapes, arrows and freehand marks.'], zh: ['无限多页面画布', '画板并排摆放，最多 40 个页面，可加分区标题、便签、图形、箭头和手绘标注。'] },
      { en: ['Live artboards, Play mode', 'Artboards run real HTML, CSS and JS; interactive ones get Play mode for click-through prototypes.'], zh: ['实时画板与 Play 模式', '画板运行真正的 HTML、CSS 和 JS；交互画板可以进入 Play 模式点击试用原型。'] },
      { en: ['Responsive preview', 'Preview at 390, 768, 1024, 1280, 1440 or 1920 wide and capture full-page screenshots at 1× or 2×.'], zh: ['响应式预览', '按 390、768、1024、1280、1440、1920 等宽度预览，并按所选宽度导出 1× 或 2× 整页长图。'] },
      { en: ['Real components', 'Install a Design System to bind its tokens to the pickers and mount its real UI components.'], zh: ['真实组件', '安装设计系统后，令牌接入选择器，还能直接挂载它的真实 UI 组件。'] },
      { en: ['Print and pagination', 'Letter or A4 paper and flow pagination for multi-page print PDFs.'], zh: ['打印与分页', '支持 Letter / A4 纸张和流式分页，导出多页打印 PDF。'] },
      { en: ['Fix it from the page', 'An artboard that fails to run shows Ask agent to fix; N errors lists every broken artboard on the page.'], zh: ['在页面上修错', '运行出错的画板下方有“Ask agent to fix”；右上角的错误数列出本页所有出错的画板。'] },
    ],
    tree: `landing-options/
├── project/
│   ├── canvas.json     # pages, boards, order, notes
│   ├── Main.dc.html    # one Design Component per artboard
│   ├── Option-B.dc.html
│   └── ds/acme/        # tokens.css, component bundle, fonts
${SHARED_TAIL}`,
    exportsNote: { en: 'HTML includes a standalone page, Figma-capture HTML, or a whole-canvas ZIP.', zh: 'HTML 可以是独立网页、供 Figma 采集的 HTML，或整个画布的 ZIP 包。' },
    prompts: {
      en: ['/open-artifact design three landing page options for a specialty coffee roaster', '/open-artifact design mobile onboarding flow (4 screens) with interactive Play mode'],
      zh: ['/open-artifact design 给精品咖啡烘焙品牌做三套不同风格的落地页方案', '/open-artifact design 移动端注册引导流程（4 个界面），带可点击 Play 原型'],
    },
  },
  {
    id: 'design-system',
    name: 'Design System',
    colors: { wash: '#fbe6bd', ink: '#865400', tint: '#c79a1b' },
    beta: false,
    usesDS: false,
    exports: [],
    tagline: {
      en: 'Tokens with themes and WCAG contrast checks, a living brand book and live component previews.',
      zh: '多主题令牌与 WCAG 对比度检查、活的品牌手册、实时组件预览。',
    },
    summary: {
      en: 'Turns brand guidelines, a frontend codebase, design files or raw assets into a browsable, editable brand book, and the single source of truth that Design, Slides, Data and Motion artifacts install and reuse.',
      zh: '把品牌规范、前端代码库、设计稿或品牌素材整理成可浏览、可编辑的品牌手册，并作为唯一事实来源，供 Design、Slides、Data 和 Motion 作品安装复用。',
    },
    features: [
      { en: ['Tokens with themes', 'Color across Light and Dark themes with contrast checks, type, spacing, radius, shadow and custom families.'], zh: ['多主题令牌', '颜色支持 Light / Dark 等多主题并检查对比度，还有字体、间距、圆角、阴影和自定义令牌族。'] },
      { en: ['Living brand book', 'A README plus up to 24 Markdown guideline sections, topped by a live visual cover.'], zh: ['活的品牌手册', '一份 README 加最多 24 篇 Markdown 规范章节，顶部是实时渲染的封面。'] },
      { en: ['Live component previews', 'Real components from a local bundle, with usage notes and TypeScript prop tables.'], zh: ['实时组件预览', '加载本地组件包展示真实组件，配使用说明和 TypeScript 属性表。'] },
      { en: ['Asset library', 'Logos, icons, illustrations, videos and PDFs in groups, with tile sizes from xl to xs.'], zh: ['素材库', 'Logo、图标、插图、视频和 PDF 分组管理，平铺尺寸从 xl 到 xs。'] },
      { en: ['Built from real sources', 'Extract exact tokens, fonts and components from a repo, a design tool export or a brand folder.'], zh: ['从真实来源提取', '从代码仓库、设计工具导出或品牌素材目录中提取准确的令牌、字体和组件。'] },
      { en: ['Installed everywhere', 'Design, Slides, Data and Motion install it, so their color and type menus stay on brand.'], zh: ['处处可装', 'Design、Slides、Data 和 Motion 都能安装它，颜色和文字菜单与品牌保持同步。'] },
    ],
    tree: `acme-brand/
├── project/
│   ├── design-system.json  # index, written last
│   ├── tokens.json         # color, type, spacing, radius, shadow…
│   ├── README.md           # the brand book
│   ├── components/
│   │   ├── Button/preview.html
│   │   └── bundle.js
│   ├── assets/Logos/
│   ├── fonts/
│   └── tokens.css          # generated
${SHARED_TAIL}`,
    exportsNote: { en: 'No file export: other artifacts install it.', zh: '不导出文件：由其他作品安装使用。' },
    prompts: {
      en: ['/open-artifact design-system extract our brand tokens, fonts and React components from ./src', '/open-artifact design-system create a brand book for Acme from these logo files and guidelines'],
      zh: ['/open-artifact design-system 从 ./src 提取我们的品牌令牌、字体和 React 组件库', '/open-artifact design-system 基于这些 Logo 和视觉规范为 Acme 创建一套品牌手册'],
    },
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard',
    colors: { wash: '#fbd6e5', ink: '#902552', tint: '#d6409f' },
    beta: true,
    usesDS: false,
    exports: ['PNG'],
    tagline: {
      en: 'Stickies, shapes, sections, auto-routed arrows, ink, tables, dot-voting, timers, live HTML embeds and live cursors.',
      zh: '便利贴、形状、分区、自动连线箭头、手绘、表格、投票贴纸、计时器、实时网页嵌入和实时光标。',
    },
    summary: {
      en: 'A shared, infinite canvas kept as small live-synced JSON documents, where you and your agent think visually together: brainstorms, retros, flowcharts, architecture diagrams, mind maps and workshops.',
      zh: '多人共享的无限白板，以小型实时同步的 JSON 文档保存，你和 Agent 在同一块画布上一起梳理思路：头脑风暴、复盘、流程图、架构图、思维导图和工作坊。',
    },
    features: [
      { en: ['Rich primitives', 'Stickies, shapes, sections, text, routed arrows (Rust/WASM geometry), ink, images, tables, stickers, timers and link cards.'], zh: ['丰富的元素', '便利贴、形状、分区、文本、自动连线箭头（Rust/WASM 几何引擎）、手绘、图片、表格、贴纸、计时器和链接卡片。'] },
      { en: ['Live HTML embeds', 'Small working pages on the board: mini prototypes, calculators, interactive charts.'], zh: ['可运行的网页嵌入', '白板上放可以运行的小页面：小原型、计算器、交互图表。'] },
      { en: ['Multiplayer', 'Live cursors, presence and shared editing when shared on a LAN or a hosted site.'], zh: ['多人协作', '分享到局域网或自建站点后，有实时光标、在线头像和同步编辑。'] },
      { en: ['A spatial teammate', 'The agent reads what you selected or commented on, tidies layouts and extends sections instead of duplicating them.'], zh: ['懂空间的队友', 'Agent 知道你选中或评论了什么，会整理排版，在已有分区上延伸而不是另起一份。'] },
      { en: ['Dot-voting and timers', 'Drop stickers to vote and run a countdown for the workshop.'], zh: ['投票与计时', '贴贴纸投票，给工作坊开个倒计时。'] },
    ],
    tree: `sprint-retro/
├── db/
│   ├── board/meta.json   # title and stacking order
│   └── elements/
│       ├── sticky-1.json # one document per element
│       └── arrow-1.json
${SHARED_TAIL}`,
    exportsNote: { en: 'ZIP archives the whole board: documents, uploads, comments, history.', zh: 'ZIP 归档整个白板：文档、上传素材、评论和历史。' },
    prompts: {
      en: ['/open-artifact whiteboard a sprint retro board with What Went Well, Friction, and Action Items', '/open-artifact whiteboard an architecture diagram of our event-driven payment pipeline'],
      zh: ['/open-artifact whiteboard 上个迭代的复盘白板，包含做得好的、痛点和改进项', '/open-artifact whiteboard 事件驱动支付系统的整体架构图'],
    },
  },
  {
    id: 'sheets',
    name: 'Sheets',
    colors: { wash: '#caecc8', ink: '#016c0f', tint: '#3d9e3a' },
    beta: true,
    usesDS: false,
    exports: ['XLSX', 'CSV'],
    tagline: {
      en: 'A Rust/WASM formula engine, tables with filters, conditional formats, charts from ranges and sliders wired to cells.',
      zh: 'Rust/WASM 公式引擎、带筛选的数据表、条件格式、基于区域的图表，以及连到单元格的滑块。',
    },
    summary: {
      en: 'A shared multi-sheet spreadsheet powered by a Rust/WASM formula engine, stored locally as an edit log. For budgets, trackers, schedules, inventories and financial models you and your agent edit together.',
      zh: '内置 Rust/WASM 公式引擎的多工作表共享电子表格，在本地以操作日志保存。适合预算表、追踪表、排期表、台账和你与 Agent 共同维护的财务模型。',
    },
    features: [
      { en: ['Full formula engine', 'Formulas recalculate across worksheets as cells change, with locale-aware formatting.'], zh: ['完整公式引擎', '单元格一变，公式跨工作表自动重算，数字和日期按地区格式显示。'] },
      { en: ['Formatting and tables', 'Number formats, fills, borders, merged cells, tables with filter buttons, frozen panes and grouped rows.'], zh: ['格式与数据表', '数字格式、填充、边框、合并单元格、带筛选按钮的数据表、冻结窗格和行列分组。'] },
      { en: ['Rules and controls', 'Dropdown validation, checkboxes and conditional formatting.'], zh: ['规则与控件', '下拉菜单校验、复选框和条件格式。'] },
      { en: ['Charts and panels', 'Charts drawn from cell ranges, and interactive panels whose sliders and inputs drive assumption cells.'], zh: ['图表与交互面板', '直接基于单元格区域画图表；交互面板里的滑块和输入框驱动假设单元格。'] },
      { en: ['Two kinds of history', 'Live cursors, cell-anchored comments, version history and per-cell edit history.'], zh: ['两层历史', '实时光标、锚定到单元格的评论、整体版本历史和单个单元格的修改历史。'] },
    ],
    tree: `budget-2027/
├── sheet/
│   ├── sheet.json     # the workbook
│   └── edits.jsonl    # the operation log (never hand-edited)
${SHARED_TAIL}`,
    exportsNote: { en: 'Imports CSV. The agent reads and writes through the type\'s read, update and batch actions.', zh: '可导入 CSV。Agent 通过类型自带的 read、update、batch 操作读写。' },
    prompts: {
      en: ['/open-artifact sheets a monthly household budget with categories, actual vs plan, and totals', '/open-artifact sheets a SaaS 12-month financial model with interactive pricing & churn sliders'],
      zh: ['/open-artifact sheets 按类别统计预算、实际支出与差额的月度家庭预算表', '/open-artifact sheets 带定价与流失率滑块的 SaaS 12 个月财务预测模型'],
    },
  },
  {
    id: 'data',
    name: 'Data',
    colors: { wash: '#fbd4d4', ink: '#a42528', tint: '#e5484d' },
    beta: true,
    usesDS: true,
    exports: ['PDF', 'HTML', 'JSON'],
    tagline: {
      en: 'Datasets from MCP connectors, CSV and JSON uploads, drawn by d3 pages, with a Sources panel and remix to a scroll story.',
      zh: '数据来自 MCP 连接器、CSV 和 JSON 上传，由 d3 页面绘制，有 Sources 溯源面板，还能 Remix 成滚动故事。',
    },
    summary: {
      en: 'Live dashboards, KPI trackers, scorecards and narrative reports backed by small JSON documents and drawn with plain HTML, CSS, JavaScript and d3. Every time a reader opens the page, the numbers are worked out again from their sources.',
      zh: '实时数据看板、KPI 追踪、记分卡和叙事报告，数据以小型 JSON 文档保存，由原生 HTML、CSS、JavaScript 和 d3 绘制。每次有人打开页面，数字都会从来源重新算一遍。',
    },
    features: [
      { en: ['Three kinds of dataset', 'Live queries on your MCP connectors, attached CSV/TSV/JSON/text files, and calculations in the browser.'], zh: ['三种数据集', '对 MCP 连接器的实时查询、附加的 CSV/TSV/JSON/文本文件，以及在浏览器里的计算。'] },
      { en: ['Sources panel', 'Shows every reader where each number came from, its query or script, and how fresh it is.'], zh: ['Sources 溯源面板', '让每位读者看到每个数字从哪条查询或脚本来、有多新。'] },
      { en: ['Filters with safe rules', 'Page filters bind into dataset parameters, checked by Rust/WASM filter rules.'], zh: ['带安全规则的筛选', '页面筛选器直接绑定数据集参数，由 Rust/WASM 规则校验。'] },
      { en: ['Hand edits and looks', 'Edit words on the page, switch ready-made looks, or install a Design System.'], zh: ['手改与外观', '直接在页面上改文字、切换内置外观，或安装设计系统。'] },
      { en: ['Remix', 'Turn a dashboard into a narrative scroll story or a short visual draft, with read-aloud.'], zh: ['Remix', '把看板改写成滚动叙事故事或简短的视觉草稿，还能朗读。'] },
    ],
    tree: `signups-dashboard/
├── db/
│   ├── dash/
│   │   ├── meta.json       # title, language
│   │   ├── params.json     # filter defaults
│   │   └── look.json
│   ├── datasets/
│   │   └── signups.json    # source: call or file
│   └── files/
│       └── index.html.json # HTML/CSS/JS + d3 page
${SHARED_TAIL}`,
    prompts: {
      en: ['/open-artifact data a monthly signups and retention dashboard from ./signups.csv', '/open-artifact data a live weekly engineering KPI scorecard querying our postgres MCP connector'],
      zh: ['/open-artifact data 基于 ./signups.csv 制作按月注册与留存率交互看板', '/open-artifact data 连接我们的 postgres MCP 数据源，做一份每周研发 KPI 实时记分卡'],
    },
  },
  {
    id: 'docs',
    name: 'Docs',
    colors: { wash: '#cce3fd', ink: '#1757ac', tint: '#3f8ef0' },
    beta: false,
    usesDS: false,
    exports: ['Markdown', 'Word', 'PDF', 'HTML'],
    tagline: {
      en: 'Tabs and subtabs, Mermaid, chips and @-mentions, suggested edits, and an agent that fills pending sections while you watch.',
      zh: '标签页与子标签页、Mermaid、智能芯片与 @ 提及、修订建议，Agent 当着你的面把待写章节一节节填好。',
    },
    summary: {
      en: 'Living, multi-tab rich-text documents backed by a block- and character-ID store. For proposals, specs, plans, reports, memos, handbooks and meeting notes you write, review with tracked suggestions, comment on and export.',
      zh: '多标签页的富文本在线文档，底层是带块 ID 和字符 ID 的结构化存储。适合方案、技术规格、计划、报告、备忘录、手册和会议纪要：共同撰写、审阅修订建议、评论、导出。',
    },
    features: [
      { en: ['Tabs and subtabs', 'Organize a proposal or handbook into tabs and subtabs, with link chips that follow renames.'], zh: ['标签页与子标签页', '用多级标签页组织方案或手册，标签页链接在重命名后自动更新。'] },
      { en: ['Rich blocks and Mermaid', 'Headings, lists, checklists, tables, code, quotes, images and live mermaid diagrams.'], zh: ['富文本块与 Mermaid', '标题、列表、任务清单、表格、代码、引用、图片，以及实时渲染的 mermaid 图。'] },
      { en: ['Smart chips', 'Dates, @-mentions, tab links and custom dropdown status lists.'], zh: ['智能芯片', '日期、@ 提及、标签页链接和自定义下拉状态。'] },
      { en: ['Suggested edits', 'The agent or a collaborator proposes changes you accept or reject one by one.'], zh: ['修订建议', 'Agent 或协作者以建议形式提交修改，由你逐条接受或拒绝。'] },
      { en: ['Watch it being written', 'The agent lays out pending sections, opens the page and fills them one by one.'], zh: ['看着它写出来', 'Agent 先摆好待写章节、打开页面，再一节一节填满。'] },
      { en: ['Imports', 'Bring in Markdown, plain text, Word (.docx) and PDF as a new doc or a new tab.'], zh: ['导入', '导入 Markdown、纯文本、Word（.docx）和 PDF，作为新文档或新标签页。'] },
    ],
    tree: `hiring-plan-2027/
├── doc/
│   └── doc.json      # tabs, blocks, characters with ids
${SHARED_TAIL}`,
    exportsNote: { en: 'The agent edits through the type\'s read and update actions, never the files by hand.', zh: 'Agent 通过类型的 read、update 操作修改，从不手改这些文件。' },
    prompts: {
      en: ['/open-artifact docs a 2027 hiring plan with tabs for Roles, Budget, and Timeline', '/open-artifact docs import ./spec.docx and propose edits for clarity as suggestions'],
      zh: ['/open-artifact docs 一份 2027 年招聘计划，分岗位、预算、时间线三个标签页', '/open-artifact docs 导入 ./spec.docx，并以修订建议模式优化表达清晰度'],
    },
  },
  {
    id: 'motion',
    name: 'Motion',
    colors: { wash: '#bfeee5', ink: '#006458', tint: '#14a38b' },
    beta: true,
    usesDS: true,
    exports: ['MP4', 'GIF', 'HTML', 'ZIP'],
    tagline: {
      en: 'Scenes in HTML/CSS/JS drawn from time t, a rough cut first and the final built while you watch, a coded score and captioned voiceover.',
      zh: '场景是按时间 t 绘制的 HTML/CSS/JS，先出粗剪、再当着你的面做成定稿，代码生成配乐，带字幕旁白。',
    },
    summary: {
      en: 'Short animated films (explainers, promos, launch clips, walkthroughs, title cards, GIFs) built as deterministic HTML, CSS and JavaScript scenes drawn as a pure function of time, backed by small JSON documents.',
      zh: '短动画影片（科普、宣传、发布短片、界面演示、片头片尾、GIF），每个场景都是按时间纯函数绘制的 HTML、CSS 和 JavaScript，以小型 JSON 文档保存。',
    },
    features: [
      { en: ['Drawn from time', 'Each scene renders from t, so scrubbing is smooth and video export is frame-accurate.'], zh: ['按时间绘制', '每个场景由时间 t 绘出，拖进度条顺滑，导出视频逐帧一致。'] },
      { en: ['Rough cut, then final', 'It opens on the rough cut; you watch the agent build scenes, music and polish live.'], zh: ['先粗剪，再定稿', '粗剪写好就打开，你看着 Agent 实时补齐场景、配乐和细节。'] },
      { en: ['Score and voiceover', 'Music and sound effects made in code, recorded voiceover with synced captions, or a clip\'s own sound.'], zh: ['配乐与旁白', '用代码合成音乐和音效，加入带同步字幕的旁白，或直接用视频片段自己的原声。'] },
      { en: ['Edit by hand', 'Retype, recolor, refont, recut scene lengths and retouch single elements, without code.'], zh: ['不写代码直接改', '改字、换色、换字体、调场景时长、微调单个元素，都不用写代码。'] },
      { en: ['Flash-safety', 'Rust/WASM flash analysis keeps flashes and cuts under three per second.'], zh: ['频闪安全', 'Rust/WASM 频闪检测，确保每秒闪烁或切换不超过 3 次。'] },
      { en: ['Comments in time and space', 'Pin a comment to an exact moment or a spot in the frame.'], zh: ['钉在时间和画面上的评论', '评论可以钉在某个时刻，或画面上的某一点。'] },
    ],
    tree: `launch-film/
├── db/
│   ├── film/
│   │   ├── meta.json
│   │   └── script.json
│   ├── modules/
│   │   ├── scenes.json.json   # scene list, stage, fps, palettes
│   │   ├── scene-intro.js.json
│   │   └── score.js.json
│   └── assets/
${SHARED_TAIL}`,
    exportsNote: { en: 'HTML is a standalone player; ZIP is the source.', zh: 'HTML 是独立播放器，ZIP 是源码包。' },
    prompts: {
      en: ['/open-artifact motion a 20-second launch animation for our open-source CLI tool', '/open-artifact motion a 30-second animated explainer showing how DNS resolution works'],
      zh: ['/open-artifact motion 为我们的开源 CLI 工具做一段 20 秒的发布宣传动画', '/open-artifact motion 做一段 30 秒的动画科普，讲清 DNS 解析是如何工作的'],
    },
  },
  {
    id: 'page',
    name: 'Page',
    colors: { wash: '#dfe4ec', ink: '#3a475a', tint: '#5b6b82' },
    beta: false,
    usesDS: false,
    exports: [],
    tagline: {
      en: 'A free HTML page with the runtime capabilities it declares: a shared database, uploads, who is viewing, live messages, comments.',
      zh: '自由的 HTML 页面，按声明开放运行时能力：共享数据库、上传、当前访问者、实时消息、评论。',
    },
    summary: {
      en: 'One complete HTML document the agent writes itself, kept as index.html in the artifact\'s folder. For small interactive things no other type fits: a widget, a calculator, a mini game, an explainer page, a poll or a sign-up sheet that remembers what people do on it.',
      zh: 'Agent 自己写的一份完整 HTML 文档，存为作品文件夹里的 index.html。适合其他类型都不合适的小型交互内容：小部件、计算器、小游戏、解释页，或能记住大家操作的投票和报名表。',
    },
    features: [
      { en: ['Your own page, whole', 'No template, framework or build step. The page\'s <title> is the artifact\'s title.'], zh: ['整张页面由你决定', '没有模板、框架或构建步骤。页面的 <title> 就是作品标题。'] },
      { en: ['Declared capabilities', 'window.openArtifact.use("db") for a shared database, uploads, files to save, the viewer, live messages and comments.'], zh: ['按声明开放能力', '通过 window.openArtifact.use("db") 取得共享数据库、上传、可保存的文件、访问者、实时消息和评论。'] },
      { en: ['claude.ai compatible', 'window.claude is the same object, so pages written for claude.ai run as they are.'], zh: ['兼容 claude.ai', 'window.claude 是同一个对象，为 claude.ai 写的页面可以照常运行。'] },
      { en: ['Live', 'Every open view reloads when index.html changes; database writes show in every view at once.'], zh: ['实时', 'index.html 一变，所有打开的视图都会重新加载；数据库写入立即出现在每个视图里。'] },
      { en: ['On a site too', 'Publish to a self-hosted Node or Cloudflare site; data, comments and uploads sync both ways.'], zh: ['也能放到站点上', '发布到自建的 Node 或 Cloudflare 站点；数据、评论和上传与本机双向同步。'] },
    ],
    tree: `lunch-poll/
├── index.html        # the page, written whole
├── db/               # its shared database, one JSON per document
├── .artifact.json    # declared capabilities
├── _blobs/
└── comments.json`,
    exportsNote: { en: 'No file export: it publishes to a Node or Cloudflare site.', zh: '不导出文件：发布到 Node 或 Cloudflare 站点。' },
    prompts: {
      en: ['/open-artifact page a unit converter for cooking measures', '/open-artifact page a team lunch poll that remembers everyone\'s vote'],
      zh: ['/open-artifact page 一个做菜用的计量单位换算器', '/open-artifact page 一个能记住每个人选择的团队午餐投票'],
    },
  },
];

/** Showcase order: the library page's tile order, then page. */
export const SHOWCASE_ORDER = ['slides', 'design', 'design-system', 'docs', 'sheets', 'data', 'whiteboard', 'motion', 'page'];
export const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));
