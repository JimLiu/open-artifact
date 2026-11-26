/**
 * The plugin's own words, beside the page's (`@open-artifact/library-page`): what a new session's input starts with
 * (`prompt.*`, page-host.ts) and the chat cards (`card.*`, components/EventCards.tsx). They are registered with the
 * page's under one namespace (index.tsx), so a host translate function bound to it knows both.
 */
import { en as pageEn, fill, zh as pageZh } from '@open-artifact/library-page/words';

/** Chinese. The keys of the plugin's own words. */
export const dshZh = {
  'prompt.slides': '帮我做一份幻灯片，主题是：',
  'prompt.design': '帮我设计：',
  'prompt.design-system': '帮我做一套设计系统，品牌是：',
  'prompt.data': '帮我做一个数据看板，数据是：',
  'prompt.docs': '帮我写一份文档，内容是：',
  'prompt.motion': '帮我做一段动画，内容是：',
  'prompt.whiteboard': '帮我在白板上画出：',
  'prompt.sheets': '帮我做一张表格，用来：',
  'prompt.generic': '帮我做一个{type}：',
  'card.comment': '已将对“{title}”的评论发给 Agent',
  'card.request': '已将“{title}”上的 {label} 发给 Agent',
  'card.message': '已将关于“{title}”的消息发给 Agent',
  'card.view': '查看评论',
  'card.more': '显示位置',
  'card.less': '收起位置',
  'card.requestLabel': '请求',
  'card.from': '来自 {name}（{role}，不是所有者）',
  'card.selectionShow': '显示所选内容',
  'card.selectionHide': '收起所选内容',
  'card.selectionMore': '还有 {count} 项',
  'card.task': '“{title}”上的 {action} 已完成，结果已发给 Agent',
  'card.taskFailed': '“{title}”上的 {action} 失败，结果已发给 Agent',
};

/** A key of the plugin's own words. */
export type DshKey = keyof typeof dshZh;

/** Whether a string is a key of the plugin's own words (for keys made from a type id). */
export const isDshKey = (key: string): key is DshKey => Object.prototype.hasOwnProperty.call(dshZh, key);

/** English. */
export const dshEn: Record<DshKey, string> = {
  'prompt.slides': 'Make me a slide deck about: ',
  'prompt.design': 'Design this for me: ',
  'prompt.design-system': 'Make me a design system for this brand: ',
  'prompt.data': 'Make me a dashboard from this data: ',
  'prompt.docs': 'Write me a doc about: ',
  'prompt.motion': 'Make me an animation about: ',
  'prompt.whiteboard': 'Lay this out on a whiteboard: ',
  'prompt.sheets': 'Make me a spreadsheet for: ',
  'prompt.generic': 'Make me a {type}: ',
  'card.comment': 'Comment on “{title}” sent to agent',
  'card.request': '{label} on “{title}” sent to agent',
  'card.message': 'Message on “{title}” sent to agent',
  'card.view': 'View thread',
  'card.more': 'Show where',
  'card.less': 'Hide where',
  'card.requestLabel': 'Request',
  'card.from': 'From {name} ({role}, not the owner)',
  'card.selectionShow': 'Show what was selected',
  'card.selectionHide': 'Hide what was selected',
  'card.selectionMore': 'and {count} more',
  'card.task': '{action} on “{title}” finished; result sent to agent',
  'card.taskFailed': '{action} on “{title}” failed; result sent to agent',
};

/** The dictionaries registered under the namespace: the page's words and the plugin's. */
export const zh = { ...pageZh, ...dshZh };
export const en = { ...pageEn, ...dshEn };

/** The plugin's words with `{name}` placeholders filled. */
export type DshTranslate = (key: DshKey, params?: Record<string, string>) => string;

/** English, for when the host has no locale service. */
export const dshFallback: DshTranslate = (key, params) => fill(dshEn[key] ?? key, params);

/** A translate function of the host's (`ctx.locale.bind(ns)`), or the fallback. */
export function dshTranslator(bound: ((key: string, params?: Record<string, string>) => string) | undefined): DshTranslate {
  if (typeof bound !== 'function') return dshFallback;
  return (key, params) => {
    const text = bound(key, params);
    // A host that leaves the placeholders to the caller, or does not know the key.
    return typeof text === 'string' && text !== key ? fill(text, params) : dshFallback(key, params);
  };
}
