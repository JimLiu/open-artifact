/**
 * The menu bar. Every item that does something of the app's own is a named command (`commands.mjs`): the menu only
 * names it, so a test can run each one by name (test mode's `desktop.test.command`) and read the menu as it is
 * (`describeMenu`). What macOS itself provides (Services, Hide, Quit, Minimize, the window list) keeps its role.
 *
 * The words are the app's (`renderer/src/words.js`, `menu.*`), in the language this run speaks; a type's name in
 * File ▸ New is the one the new-artifact dialog shows, in the dialog's two groups and order.
 *
 * `enabled(name)` says whether a command can run now (no artifact in front: Show in Finder, Move To…, Close Tab and
 * Reload are greyed out); the menu is built again when that changes (`menuKey`), and when the types change.
 */
import { BUILTIN_START, builtinStartOf } from '@open-artifact/protocol';
import { typeName } from '../renderer/src/words.js';

const order = (list) => (a, b) => {
  const at = (id) => (list.includes(id) ? list.indexOf(id) : list.length);
  return at(a.id) - at(b.id);
};

/** The types under File ▸ New, as the new-artifact dialog groups them: those that start blank, then the agent's. */
export function newGroups(types) {
  const list = Array.isArray(types) ? types.filter((type) => typeof type?.id === 'string') : [];
  return {
    blank: list.filter((type) => builtinStartOf(type.id) === 'blank').sort(order(BUILTIN_START.blank)),
    agent: list.filter((type) => builtinStartOf(type.id) !== 'blank').sort(order(BUILTIN_START.agent)),
  };
}

/** A named command's item: `run(name, arg)` on click, `enabled(name)` now. */
const commandMaker = (run, enabled) => (name, label, extra = {}) => ({
  id: name,
  label,
  enabled: enabled(name),
  click: () => run(name, extra.arg),
  ...(extra.accelerator ? { accelerator: extra.accelerator } : {}),
  ...(extra.submenu ? { submenu: extra.submenu } : {}),
});
const sep = { type: 'separator' };

/** The Edit menu, the same in both windows: every item a command on the page in front. */
const editMenu = (t, command) => ({
  label: t('menu.edit'),
  submenu: [
    command('edit:undo', t('menu.undo'), { accelerator: 'CmdOrCtrl+Z' }),
    command('edit:redo', t('menu.redo'), { accelerator: 'Shift+CmdOrCtrl+Z' }),
    sep,
    command('edit:cut', t('menu.cut'), { accelerator: 'CmdOrCtrl+X' }),
    command('edit:copy', t('menu.copy'), { accelerator: 'CmdOrCtrl+C' }),
    command('edit:paste', t('menu.paste'), { accelerator: 'CmdOrCtrl+V' }),
    command('edit:paste-plain', t('menu.pastePlain'), { accelerator: 'Shift+Alt+CmdOrCtrl+V' }),
    command('edit:delete', t('menu.delete')),
    command('edit:select-all', t('menu.selectAll'), { accelerator: 'CmdOrCtrl+A' }),
  ],
});

/**
 * The menu's template. `t`: the words; `types`: the library's types (`{ id, title }`); `run(name, arg)`: runs a
 * command; `enabled(name)`: whether it can run now; `appName`; `platform`.
 */
export function menuTemplate({ t, types = [], run, enabled = () => true, appName = 'Open Artifact', platform = process.platform }) {
  const command = commandMaker(run, enabled);
  const groups = newGroups(types);
  const typeItem = (type) => command(`new:${type.id}`, typeName(t, type.id, type.title), { arg: type.id });
  const newMenu = [
    ...(groups.blank.length ? [{ label: t('group.blank'), enabled: false }, ...groups.blank.map(typeItem)] : []),
    ...(groups.blank.length && groups.agent.length ? [sep] : []),
    ...(groups.agent.length ? [{ label: t('group.agent'), enabled: false }, ...groups.agent.map(typeItem)] : []),
  ];
  const mac = platform === 'darwin';
  return [
    ...(mac
      ? [
          {
            label: appName,
            submenu: [
              command('about', t('menu.about', { app: appName })),
              sep,
              command('settings', t('menu.settings'), { accelerator: 'CmdOrCtrl+,' }),
              sep,
              { role: 'services', label: t('menu.services') },
              sep,
              { role: 'hide', label: t('menu.hide', { app: appName }) },
              { role: 'hideOthers', label: t('menu.hideOthers') },
              { role: 'unhide', label: t('menu.showAll') },
              sep,
              { role: 'quit', label: t('menu.quit', { app: appName }) },
            ],
          },
        ]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        { id: 'new', label: t('menu.new'), submenu: newMenu.length ? newMenu : [{ label: t('new.none'), enabled: false }] },
        command('new-dialog', t('menu.newDialog'), { accelerator: 'CmdOrCtrl+N' }),
        sep,
        command('open-folder', t('menu.openFolder'), { accelerator: 'CmdOrCtrl+O' }),
        command('import', t('menu.import'), { accelerator: 'CmdOrCtrl+Shift+O' }),
        sep,
        command('reveal', t('menu.reveal'), { accelerator: 'CmdOrCtrl+Alt+R' }),
        command('move', t('menu.move')),
        sep,
        command('close-tab', t('menu.closeTab'), { accelerator: 'CmdOrCtrl+W' }),
        ...(mac ? [] : [sep, { role: 'quit', label: t('menu.quit', { app: appName }) }]),
      ],
    },
    editMenu(t, command),
    {
      label: t('menu.view'),
      submenu: [
        command('reload', t('menu.reload'), { accelerator: 'CmdOrCtrl+R' }),
        command('toggle-sidebar', t('menu.toggleSidebar'), { accelerator: mac ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S' }),
        sep,
        command('zoom-reset', t('menu.actualSize'), { accelerator: 'CmdOrCtrl+0' }),
        command('zoom-in', t('menu.zoomIn'), { accelerator: 'CmdOrCtrl+=' }),
        command('zoom-out', t('menu.zoomOut'), { accelerator: 'CmdOrCtrl+-' }),
        sep,
        command('fullscreen', t('menu.fullscreen'), { accelerator: mac ? 'Ctrl+Cmd+F' : 'F11' }),
      ],
    },
    {
      label: t('menu.window'),
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        sep,
        command('previous-tab', t('menu.previousTab'), { accelerator: 'CmdOrCtrl+Shift+[' }),
        command('next-tab', t('menu.nextTab'), { accelerator: 'CmdOrCtrl+Shift+]' }),
        ...(mac ? [sep, { role: 'front', label: t('menu.front') }] : []),
      ],
    },
    {
      label: t('menu.help'),
      role: 'help',
      submenu: [command('logs', t('menu.logs')), command('doctor', t('menu.doctor'))],
    },
  ];
}

/**
 * The menu bar of an artifact installed as an app (`artifact-app.mjs`): the app menu (About, the library in the desktop
 * app, Hide, Quit), File (Show Artifact Folder in Finder, Close Window), Edit, View (Reload, zoom, full screen) and
 * Window. `appName`: the app's name (the artifact's); macOS itself shows the package's `CFBundleName` ("Open
 * Artifact") as the bold name of the first menu, whatever its label here.
 */
export function artifactMenuTemplate({ t, run, enabled = () => true, appName, platform = process.platform }) {
  const command = commandMaker(run, enabled);
  const mac = platform === 'darwin';
  return [
    ...(mac
      ? [
          {
            label: appName,
            submenu: [
              command('about', t('menu.about', { app: appName })),
              sep,
              command('library', t('menu.openLibrary')),
              sep,
              { role: 'services', label: t('menu.services') },
              sep,
              { role: 'hide', label: t('menu.hide', { app: appName }) },
              { role: 'hideOthers', label: t('menu.hideOthers') },
              { role: 'unhide', label: t('menu.showAll') },
              sep,
              { role: 'quit', label: t('menu.quit', { app: appName }) },
            ],
          },
        ]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        command('reveal', t('menu.reveal'), { accelerator: 'CmdOrCtrl+Alt+R' }),
        sep,
        command('close-window', t('menu.closeWindow'), { accelerator: 'CmdOrCtrl+W' }),
        ...(mac ? [] : [sep, { role: 'quit', label: t('menu.quit', { app: appName }) }]),
      ],
    },
    editMenu(t, command),
    {
      label: t('menu.view'),
      submenu: [
        command('reload', t('menu.reload'), { accelerator: 'CmdOrCtrl+R' }),
        sep,
        command('zoom-reset', t('menu.actualSize'), { accelerator: 'CmdOrCtrl+0' }),
        command('zoom-in', t('menu.zoomIn'), { accelerator: 'CmdOrCtrl+=' }),
        command('zoom-out', t('menu.zoomOut'), { accelerator: 'CmdOrCtrl+-' }),
        sep,
        command('fullscreen', t('menu.fullscreen'), { accelerator: mac ? 'Ctrl+Cmd+F' : 'F11' }),
      ],
    },
    {
      label: t('menu.window'),
      role: 'windowMenu',
      submenu: [{ role: 'minimize', label: t('menu.minimize') }, { role: 'zoom', label: t('menu.zoom') }, ...(mac ? [sep, { role: 'front', label: t('menu.front') }] : [])],
    },
  ];
}

/** The commands a template names (every item with a click), for a check that each has a handler. */
export function templateCommands(template) {
  const out = [];
  const walk = (items) => {
    for (const item of items ?? []) {
      if (item.click && item.id) out.push(item.id);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

/** A built `Menu` as plain data (what a test reads): label, id, role, type, accelerator, enabled, submenu. */
export function describeMenu(menu) {
  if (!menu) return null;
  return menu.items.map((item) => ({
    label: item.label,
    ...(item.id ? { id: item.id } : {}),
    ...(item.role ? { role: item.role } : {}),
    type: item.type,
    ...(item.accelerator ? { accelerator: String(item.accelerator) } : {}),
    enabled: item.enabled,
    ...(item.submenu ? { submenu: describeMenu(item.submenu) } : {}),
  }));
}
