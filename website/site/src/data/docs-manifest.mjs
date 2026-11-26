// Which markdown files become doc pages, under which route, in which sidebar group.
// `src` is the English file, relative to the repo root; its Chinese pair is the same path with
// .zh-CN.md, used when it exists (zh pages fall back to English with a note otherwise).
// Page titles come from each file's first heading; `label` overrides the sidebar text.

const TYPE_IDS = ['slides', 'design', 'design-system', 'whiteboard', 'sheets', 'data', 'docs', 'motion', 'page'];

export const DOC_GROUPS = [
  {
    id: 'start',
    title: { en: 'Get started', zh: '开始使用' },
    items: [
      { slug: '', src: 'docs/README.md', label: { en: 'Documentation home', zh: '文档首页' } },
      { slug: 'overview', src: 'docs/overview.md', label: { en: 'What is Open Artifact?', zh: '什么是 Open Artifact？' } },
      { slug: 'artifact-types', src: 'docs/artifact-types.md', label: { en: 'Artifact types overview', zh: 'Artifact 类型总览' } },
      { slug: 'settings', src: 'docs/settings.md', label: { en: 'Settings & where artifacts go', zh: '设置与作品存放位置' } },
      { slug: 'custom-types', src: 'docs/custom-types.md', label: { en: 'Making your own types', zh: '自己做 Artifact 类型' } },
    ],
  },
  {
    id: 'types',
    title: { en: 'Artifact types', zh: '作品类型' },
    items: TYPE_IDS.map((t) => ({ slug: `types/${t}`, src: `docs/types/${t}.md` })),
  },
  {
    id: 'hosting',
    title: { en: 'Self-hosting', zh: '自托管' },
    items: [
      { slug: 'hosting', src: 'docs/hosting.md', label: { en: 'Putting artifacts on a site', zh: '把作品放到站点上' } },
      { slug: 'hosting-lan', src: 'docs/hosting-lan.md', label: { en: 'On your home or office network', zh: '家里或办公室的局域网' } },
      { slug: 'hosting-server', src: 'docs/hosting-server.md', label: { en: 'On your own server', zh: '自己的服务器' } },
      { slug: 'hosting-cloudflare', src: 'docs/hosting-cloudflare.md', label: { en: 'On Cloudflare', zh: 'Cloudflare' } },
      { slug: 'connecting-agents', src: 'docs/connecting-agents.md', label: { en: 'Connecting computers & agents', zh: '连接电脑和 Agent' } },
      { slug: 'plugins', src: 'docs/plugins.md', label: { en: 'Site plugins', zh: '站点插件' } },
    ],
  },
  {
    id: 'agents',
    title: { en: 'For agents', zh: '给 Agent' },
    items: [
      { slug: 'agent-guide', src: 'docs/agent-guide.md', label: { en: 'How agents use Open Artifact', zh: 'Agent 使用指南' } },
      { slug: 'skill', src: 'skills/open-artifact/SKILL.md', label: { en: 'The /open-artifact skill', zh: '/open-artifact skill' } },
      ...TYPE_IDS.map((t) => ({ slug: `skills/${t}`, src: `artifact-types/${t}/SKILL.md`, label: { en: `${t} SKILL.md`, zh: `${t} SKILL.md` }, mono: true })),
    ],
  },
  {
    id: 'integrators',
    title: { en: 'For integrators', zh: '给集成方' },
    items: [
      { slug: 'integrating', src: 'docs/integrating.md', label: { en: 'Integrating Open Artifact', zh: '接入 Open Artifact' } },
      ...['tools', 'wake', 'embedding', 'remote-types', 'runtime', 'non-node', 'security', 'testing', 'limits'].map((n) => ({ slug: `integrating/${n}`, src: `docs/integrating/${n}.md` })),
      { slug: 'spec/harness-api', src: 'docs/spec/harness-api.md' },
      { slug: 'spec/embed', src: 'docs/spec/embed.md' },
      { slug: 'spec/profile', src: 'docs/spec/profile.md' },
      { slug: 'harness-kit', src: 'packages/harness-kit/README.md', label: { en: '@open-artifact/harness-kit', zh: '@open-artifact/harness-kit' }, mono: true },
    ],
  },
];

export const DOC_ITEMS = DOC_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));
