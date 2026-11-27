// The playground's live demos, as the site and the playground's landing page describe them. The type pages' taglines
// (types.mjs) describe the type; these lines describe what the demo holds. A plain module without imports: the
// playground's build reads it too (playground/pages.ts).

/** What each demo holds, in both languages. */
export const DEMO_LINES = {
  slides: { en: 'A two-slide deck: retype text, move things, add speaker notes.', zh: '一份两页的演示文稿：改文字、挪元素、写演讲者备注。' },
  design: { en: 'A launch card on a canvas, one artboard you can edit directly.', zh: '画布上的一张发布卡片，一个可以直接编辑的画板。' },
  'design-system': { en: 'Tokens, a text style and a Button component.', zh: '设计令牌、一个文字样式和一个按钮组件。' },
  whiteboard: { en: 'A board with one of every element kind: notes, shapes, connectors, frames.', zh: '一块白板，每种元素都有：便利贴、形状、连线、框架。' },
  sheets: { en: 'A sales workbook whose formulas the real Sheets engine (WebAssembly) works out in your browser.', zh: '一份销售工作簿，公式由真正的 Sheets 引擎（WebAssembly）在浏览器里计算。' },
  data: { en: 'A sales and signups dashboard from a saved snapshot and a CSV.', zh: '一个销售与注册看板，数据来自保存的快照和一个 CSV。' },
  docs: { en: 'A living doc with three tabs, run by the real Docs engine in your browser.', zh: '一份有三个标签页的文档，由真正的 Docs 引擎在浏览器里运行。' },
  motion: { en: 'A five-second film with two scenes and narration.', zh: '一段五秒的短片，两个场景，带旁白。' },
  page: { en: 'A packing checklist: a free HTML page with its own database.', zh: '一份行李清单：一个自带数据库的自由 HTML 页面。' },
};

/** The demos on the home page's live stage, in tab order; the first one is shown first. */
export const STAGE_ORDER = ['design', 'whiteboard', 'slides', 'docs', 'sheets', 'data', 'motion', 'design-system', 'page'];
