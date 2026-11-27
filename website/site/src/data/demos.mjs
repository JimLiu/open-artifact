// The playground's live demos, as the site and the playground's landing page describe them. The type pages' taglines
// (types.mjs) describe the type; these lines describe what the demo holds. A plain module without imports: the
// playground's build reads it too (playground/pages.ts).

/** What each demo holds, in both languages. */
export const DEMO_LINES = {
  slides: { en: 'A launch review deck: eight designed slides, a chart and speaker notes, written as you watch.', zh: '一份发布评审演示：八张精排幻灯片、图表与演讲备注，看着 Agent 一张张写出来。' },
  design: { en: 'Juniper’s launch on one canvas: a landing hero and two phone screens you can play.', zh: '一张画布上的 Juniper 春季发布：落地页首屏，加两个可以直接点着玩的手机屏。' },
  'design-system': { en: 'Juniper’s design system: tokens in light and dark, a brand book, nine live components.', zh: 'Juniper 的设计系统：浅色深色两套 token、品牌手册，加九个可实时预览的组件。' },
  whiteboard: { en: 'Launch week on one board: a timeline, a journey flow, sticky risks, and a go/no-go table.', zh: '一块白板排好发布周：时间线、用户旅程流程图、风险便签，还有 Go/no-go 表。' },
  sheets: { en: 'A launch budget workbook: live formulas, variance rules, a chart that follows every edit.', zh: '发布预算工作簿：公式实时重算，超支自动标红，图表随每次修改更新。' },
  data: { en: 'A subscriptions dashboard on live shop queries: KPIs, goal tracking, roasts and a plan filter.', zh: '接入店铺实时查询的订阅看板：关键指标、目标进度、各款豆子出货，还能按套餐筛选。' },
  docs: { en: 'A launch brief in three tabs: tables with live chips, a diagram, callouts and checklists.', zh: '三个标签页的发布简报：带日期和状态标签的表格、流程图、提示框和清单。' },
  motion: { en: 'An 18-second launch teaser in four scenes: sunrise, a pour, tasting notes, an end card.', zh: '一支 18 秒的上市预告片：日出、冲煮、风味、片尾，每一帧都由代码画成。' },
  page: { en: 'A brew guide you can use: dose slider, step timer and a tasting log in its own database.', zh: '一份能用的冲煮指南：粉量滑杆、分步计时器，品鉴记录存在页面自带的数据库里。' },
};

/** The demos on the home page's live stage, in tab order; the first one is shown first. */
export const STAGE_ORDER = ['design', 'whiteboard', 'slides', 'docs', 'sheets', 'data', 'motion', 'design-system', 'page'];
