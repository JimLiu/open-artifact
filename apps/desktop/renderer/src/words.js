// The app's own words (the sidebar, the tab bar, the new-artifact dialog), in Chinese and English. The home page's
// words are the package's (`@open-artifact/library-page/words`); `translate` reads both, the app's first.
import { en as pageEn, fill, zh as pageZh } from '@open-artifact/library-page/words';

const zh = {
  'app.title': 'Open Artifact',
  'sidebar.label': '侧边栏',
  'sidebar.collapse': '收起侧边栏',
  'sidebar.expand': '展开侧边栏',
  'nav.back': '后退',
  'nav.forward': '前进',
  'nav.new': '新建',
  'nav.search': '搜索',
  'nav.library': '作品库',
  'nav.pinned': '置顶',
  'nav.recent': '最近',
  'nav.untitled': '未命名',
  'tabs.label': '打开的作品',
  'tabs.new': '新建作品',
  'tabs.close': '关闭标签 {title}',
  'tabs.unsaved': '有未保存的修改',
  'tabs.opening': '正在打开…',
  'tabs.reconnecting': '正在重连…',
  'tabs.stale': '重新载入',
  'tabs.staleHint': '断开时这里有没保存的修改，点一下重新载入',
  'tabs.crashed': '页面崩溃了',
  'connection.lost': '正在重新连接 Open Artifact…',
  'group.blank': '直接开始',
  'group.agent': '和 agent 一起做',
  'new.title': '新建作品',
  'new.blank': '直接开始：建好就进编辑器，自己动手写',
  'new.agent': '和 agent 一起做：先建一份空作品，再交给 agent 来搭',
  'new.name': '名称',
  'new.namePlaceholder': '不填就用默认名称',
  'new.cancel': '取消',
  'new.create': '创建并打开',
  'new.creating': '正在创建…',
  'new.pick': '先选一种作品',
  'new.failed': '没有建成：{message}',
  'new.none': '还没有可以新建的类型。',
  'create.failed': '没有建成：{message}',
};

const en = {
  'app.title': 'Open Artifact',
  'sidebar.label': 'Sidebar',
  'sidebar.collapse': 'Collapse sidebar',
  'sidebar.expand': 'Expand sidebar',
  'nav.back': 'Back',
  'nav.forward': 'Forward',
  'nav.new': 'New',
  'nav.search': 'Search',
  'nav.library': 'Library',
  'nav.pinned': 'Pinned',
  'nav.recent': 'Recent',
  'nav.untitled': 'Untitled',
  'tabs.label': 'Open artifacts',
  'tabs.new': 'New artifact',
  'tabs.close': 'Close tab {title}',
  'tabs.unsaved': 'Not saved yet',
  'tabs.opening': 'Opening…',
  'tabs.reconnecting': 'Reconnecting…',
  'tabs.stale': 'Reload',
  'tabs.staleHint': 'This tab had unsaved changes when the connection dropped: click to load it again',
  'tabs.crashed': 'The page crashed',
  'connection.lost': 'Reconnecting to Open Artifact…',
  'group.blank': 'Start writing',
  'group.agent': 'Build with an agent',
  'new.title': 'New artifact',
  'new.blank': 'Start writing: it opens in its editor, for you to write',
  'new.agent': 'Build with an agent: an empty artifact, for an agent to build',
  'new.name': 'Name',
  'new.namePlaceholder': 'Leave empty for the default name',
  'new.cancel': 'Cancel',
  'new.create': 'Create and open',
  'new.creating': 'Creating…',
  'new.pick': 'Pick a kind first',
  'new.failed': 'It was not made: {message}',
  'new.none': 'No type can be made yet.',
  'create.failed': 'It was not made: {message}',
};

export const APP_WORDS = { zh, en };

/** One language's words: the app's and the page's; English for a key the language lacks. */
export function wordsFor(locale) {
  const app = locale === 'zh' ? zh : en;
  const page = locale === 'zh' ? pageZh : pageEn;
  return (key, params) => fill(app[key] ?? page[key] ?? en[key] ?? pageEn[key] ?? key, params);
}

/** A type's name: the page's word for a type it knows, else the type's own title. */
export function typeName(t, id, title) {
  const key = `type.${id}`;
  const word = t(key);
  return word !== key ? word : title || id;
}
