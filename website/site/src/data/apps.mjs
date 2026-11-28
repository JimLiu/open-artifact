// Agent apps and their install steps, from README.md ("Quick start") and plugins/<app>/README.md.
// "/path/to/open-artifact-plugins" is the extracted release ZIP, as in the plugin READMEs.

import { ghFile } from '../config.mjs';

const ZIP = '/path/to/open-artifact-plugins';

export const APPS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    sub: { en: 'CLI, desktop, IDE', zh: 'CLI、桌面版、IDE' },
    zip: true,
    steps: {
      en: ['Add the extracted folder as a marketplace, then install open-artifact@open-artifact.'],
      zh: ['把解压目录添加为插件市场，再安装 open-artifact@open-artifact。'],
    },
    code: `claude plugin marketplace add "${ZIP}"\nclaude plugin install open-artifact@open-artifact`,
    guide: ghFile('plugins/claude-code/README.md'),
  },
  {
    id: 'codex',
    name: 'Codex',
    sub: { en: 'CLI, app, and ChatGPT desktop', zh: 'CLI、应用，以及 ChatGPT 桌面版' },
    zip: true,
    steps: {
      en: ['Add the extracted folder as a marketplace.', 'Install Open Artifact from Plugins.'],
      zh: ['把解压目录添加为插件市场。', '到 Plugins 里安装 Open Artifact。'],
    },
    code: `codex plugin marketplace add "${ZIP}"`,
    guide: ghFile('plugins/codex/README.md'),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    sub: { en: 'Local plugin', zh: '本地插件' },
    zip: true,
    steps: {
      en: ['Copy the extracted cursor/ folder into Cursor\'s local plugins.', 'Run Developer: Reload Window.'],
      zh: ['把解压出的 cursor/ 复制到 Cursor 的本地插件目录。', '运行 Developer: Reload Window。'],
    },
    code: `mkdir -p ~/.cursor/plugins/local\ncp -R "${ZIP}/cursor" ~/.cursor/plugins/local/open-artifact`,
    guide: ghFile('plugins/cursor/README.md'),
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    sub: { en: 'Command line', zh: '命令行' },
    zip: true,
    steps: {
      en: ['Add the extracted folder as a marketplace, then install open-artifact@open-artifact.'],
      zh: ['把解压目录添加为插件市场，再安装 open-artifact@open-artifact。'],
    },
    code: `copilot plugin marketplace add "${ZIP}"\ncopilot plugin install open-artifact@open-artifact`,
    guide: ghFile('plugins/copilot/README.md'),
  },
  {
    id: 'copilot-vscode',
    name: 'Copilot in VS Code',
    sub: { en: 'VS Code chat', zh: 'VS Code 聊天' },
    zip: true,
    steps: {
      en: ['Run Chat: Install Plugin from Source.', 'Select the extracted copilot/ folder.'],
      zh: ['运行 Chat: Install Plugin from Source。', '选择解压出的 copilot/ 目录。'],
    },
    code: null,
    guide: ghFile('plugins/copilot/README.md'),
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    sub: { en: 'Plugin', zh: '插件' },
    zip: true,
    steps: {
      en: ['Install the extracted antigravity/ folder with agy, or copy it to ~/.gemini/config/plugins/open-artifact.', 'Restart the app.'],
      zh: ['用 agy 安装解压出的 antigravity/，或把它复制到 ~/.gemini/config/plugins/open-artifact。', '重启应用。'],
    },
    code: `agy plugin install "${ZIP}/antigravity"`,
    guide: ghFile('plugins/antigravity/README.md'),
  },
  {
    id: 'zcode',
    name: 'ZCode',
    sub: { en: 'Plugin Marketplace', zh: '插件市场' },
    zip: true,
    steps: {
      en: ['In Plugin Marketplace, add the extracted zcode/ folder as a plugin marketplace.', 'Install Open Artifact from the listing.'],
      zh: ['在插件市场里把解压出的 zcode/ 添加为插件市场。', '从列表里安装 Open Artifact。'],
    },
    code: null,
    guide: ghFile('plugins/zcode/README.md'),
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT on the web',
    nameZh: '网页版 ChatGPT',
    sub: { en: 'Connector over HTTPS', zh: '通过 HTTPS 接入的连接器' },
    zip: true,
    steps: {
      en: ['Run the connector from the extracted chatgpt/ folder; it prints a local address with a secret path.', 'Expose port 4891 over HTTPS (for example with a tunnel) and add it in ChatGPT as a custom MCP server.'],
      zh: ['从解压出的 chatgpt/ 运行连接器，它会打印一个带密钥路径的本地地址。', '通过 HTTPS 暴露 4891 端口（例如用隧道），再在 ChatGPT 里把它添加为自定义 MCP 服务器。'],
    },
    code: `node "${ZIP}/chatgpt/skills/open-artifact/scripts/open-artifact.mjs" chatgpt --workspace ~/Documents`,
    guide: ghFile('plugins/chatgpt/README.md'),
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    sub: { en: 'From npm', zh: '从 npm 安装' },
    zip: false,
    steps: {
      en: ['In Plugins, choose Add plugin and enter dsh-open-artifact as the npm package.', 'Or, for the web profile in the CLI:'],
      zh: ['在插件页面选择「添加插件」，输入 npm 包名 dsh-open-artifact。', '或者在 CLI 里为 web profile 安装：'],
    },
    code: 'dsh plugin --profile web add dsh-open-artifact',
    guide: 'https://www.npmjs.com/package/dsh-open-artifact',
  },
  {
    id: 'pi',
    name: 'Pi',
    sub: { en: 'From npm', zh: '从 npm 安装' },
    zip: false,
    steps: {
      en: ['Install the package, then start a new Pi session.'],
      zh: ['安装这个包，然后开一个新的 Pi 会话。'],
    },
    code: 'pi install npm:pi-open-artifact',
    guide: ghFile('plugins/pi/README.md'),
  },
  {
    id: 'omp',
    name: 'OMP',
    sub: { en: 'From npm', zh: '从 npm 安装' },
    zip: false,
    steps: {
      en: ['Install the package, then start a new OMP session.'],
      zh: ['安装这个包，然后开一个新的 OMP 会话。'],
    },
    code: 'omp plugin install npm:omp-open-artifact',
    guide: ghFile('plugins/omp/README.md'),
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    sub: { en: 'CLI and gateway', zh: 'CLI 与网关' },
    zip: true,
    steps: {
      en: ['Link the extracted hermes/ folder as ~/.hermes/plugins/open-artifact and enable it, let it start turns so page comments reach the session, then install the skill.'],
      zh: ['把解压出的 hermes/ 链接为 ~/.hermes/plugins/open-artifact 并启用；允许它发起新回合，页面评论才能回到会话；最后安装 skill。'],
    },
    code: `ln -s "${ZIP}/hermes" ~/.hermes/plugins/open-artifact\nhermes plugins enable open-artifact\nhermes config set plugins.entries.open-artifact.allow_gateway_injection true\nnode ~/.hermes/plugins/open-artifact/skills/open-artifact/scripts/open-artifact.mjs skill install --command open-artifact --dir ~/.hermes/skills --harness hermes`,
    guide: ghFile('plugins/hermes/README.md'),
  },
  {
    id: 'other',
    name: 'Any other agent',
    nameZh: '其他任何 Agent',
    sub: { en: 'Skill + command line', zh: 'Skill + 命令行' },
    zip: true,
    steps: {
      en: ['Copy codex/skills/open-artifact/ from the extracted bundle to your agent\'s skill directory. It carries the daemon, and the agent drives it from the command line.', 'From the extracted bundle root, try:'],
      zh: ['把解压目录里的 codex/skills/open-artifact/ 复制到 Agent 的 skill 目录。它自带后台服务，Agent 通过命令行使用。', '在解压目录中可以试试：'],
    },
    code: `node codex/skills/open-artifact/scripts/open-artifact.mjs artifact '{"action":"list","scope":"types"}'`,
    guide: ghFile('skills/open-artifact/SKILL.md'),
  },
];

export const appName = (app, lang) => (lang === 'zh' && app.nameZh) || app.name;
