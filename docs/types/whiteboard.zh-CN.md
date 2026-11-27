# Whiteboard（白板）

[English](whiteboard.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Whiteboard** 是一块多人共享、以小型实时同步 JSON 文档存储的无限白板，让你和 Agent 在同一块画布上并肩梳理思路。适合头脑风暴、迭代复盘、流程图、系统架构图、思维导图、用户旅程图和团队工作坊。

> **什么时候不用 Whiteboard：** 不适合像素级 UI 界面设计或印刷品（请用 [Design](design.zh-CN.md)）、分页演示文稿（请用 [Slides](slides.zh-CN.md)）或长篇文档（请用 [Docs](docs.zh-CN.md)）。

## 核心功能

- **丰富的白板元素**：便利贴、基础图形、分区框（sections）、自由文本、智能连线箭头（由 Rust/WASM 几何引擎驱动）、手绘笔迹、上传图片与 SVG、表格、投票贴纸（stickers）、倒计时器、链接卡片，以及**可运行交互网页嵌入（embeds）**（小型原型、计算器、动态图表等）。
- **多人实时协作**：分享到局域网或自托管站点后，支持实时光标、协作者头像、同步编辑和工作坊计时器。
- **懂空间的 AI 队友**：Agent 能感知你当前选中或评论锚定的区域，按逻辑排版整理杂乱内容，在已有分区上自然延伸而不是在旁边复制一份，并在放大元素时自动推开相邻项避免重叠。
- **评论与 “Send to agent”**：将评论钉在具体元素或区域上，一键发给 Agent 处理。
- **导出与归档**：在 **Share → Export** 中导出 **PNG** 图片（白板上有流动箭头时还能导出 **GIF 动图**或 **MP4 视频**），或用 CLI 将整个白板（文档、上传素材、评论、历史）打包为可迁移的 `.zip`。

## 用户怎么用

### 创建白板
```text
/open-artifact whiteboard 上个迭代的复盘白板，包含做得好的、痛点和改进项
/open-artifact whiteboard 事件驱动支付系统的整体架构图
/open-artifact whiteboard Q4 增长实验的思维导图
```

也可以不用 Agent 直接开始：在主页点 **新建作品**（英文界面是 **New artifact**），选 **Whiteboard**，起个名字，就会打开一块空白白板的编辑器，自己添加便利贴（在白板上右键，选 **Add a note here**）。用别的方式建出来的空白板会先显示空状态页，点其中的 **从空白开始**（英文界面是 **Start blank**）打开同一个编辑器。点 **Send to agent** 发出的内容会先等着，直到有会话接手这块白板。

### 协作与导出
- **自由创作与整理**：拖拽便利贴、用分区归类、画连线和草图、用贴纸投票、打开计时器主持讨论。
- **移动视图**：滚轮或触控板双指滑动平移，**⌘ + 滚轮**（Ctrl + 滚轮）或双指捏合以指针为中心缩放。按住鼠标**右键**或**中键**拖动、按住**空格**拖动，或用抓手工具（**Hand**）都能平移白板；右键拖动不改变选中、也不弹菜单，右键单击不动仍然打开右键菜单。
- **跳到分区**：打开右上角的缩放菜单，在 **Go to section** 里选一个分区，视图会平滑地移到那里（连同标题，最多放大到 100%）。没有标题的分区不列出。
- **链接到白板上的内容**：右键一个元素选 **Copy link to item**，再把它粘贴到白板上成为链接卡片，或粘贴到图片的链接、文字链接里；在文字链接的输入框里也可以直接从列表选一个分区。点这样的链接，视图会移到那个元素并短暂圈出它；底部的 **Back** 回到原来的位置。目标元素被删掉的卡片会变灰。在浏览器里打开复制的链接，会直接打开白板并定位到那个元素。
- **流动箭头**：选中一根箭头，打开 **Line**，选 **Flowing**，虚线的小段就会一直朝箭头方向走，用来表示有东西沿这条线在流动（请求、数据、资金）。选 **Dashed** 就停下来。只想在自己屏幕上不动，可以在缩放菜单里关掉 **Animate lines**；系统设置了减少动态效果时也不动。
- **结合上下文让 Agent 协助**：框选一组便利贴或留一条评论（如“按主题聚类并总结前三大风险”），点击 **Send to agent**。
- **导出**：打开 **Share → Export** 下载 PNG 图片；白板上有流动箭头时，还可以下载循环播放的 **Animated GIF**（半秒一圈、10 帧，取景和 PNG 一样）或 **MP4 video**（6 秒、无声，最长边 1920 像素）。浏览器不能生成视频时，MP4 一行显示为灰色，并说明原因。
- **形状库**：把成套的图标加到白板上，从 **Shapes → Library** 里放置；见 [形状库](#形状库)。

## 形状库

形状库是一组图形，比如服务器、数据库、消息队列、用户这类图标。把它添加到白板上一次，之后想放几个就放几个。形状库跟着白板走：打开这块白板的每个人看到的是同一套，拷贝白板文件夹或它的 `.zip` 归档时也一起带走。从 **Share → Export** 导出的 **Board file** 只带已经放好的形状，不带形状库。Open Artifact 本身不附带任何形状库；图标集通常来自你本来就在画的那些工具、服务和设计系统的官方发布，或者采用开放许可的图标合集，也可以是团队自己画的。

- **添加**：在工具栏打开 **Shapes**，再点 **Library**（最后一个按钮，在 Table 后面）。点 **Add library… → From a file…**，选一个形状库文件，或者一个或多个 `.svg` 文件（这些会合成一个叫 “My shapes” 的形状库）。也可以把文件直接拖到面板上。一块白板最多放 8 个形状库。可以添加这些文件（面板按文件内容区分，不看文件名）：
  - `.shapes.json` 形状库（见下文）；
  - SVG 文件打成的 `.zip`：整个 zip 是一个形状库，以 zip 的文件名命名；每个 `.svg` 是一个形状，以文件名命名，所在的文件夹名成为它的标签，所以搜文件夹名就能找到里面的形状。zip 里的其他文件、`__MACOSX/` 和隐藏文件会被跳过。zip 最大 4 MB；最多读 500 个图形，每个解压后不超过 400,000 字节，合计不超过 16 MB；加密的条目和 zip64 条目不收；
  - draw.io 形状库（`.xml` 或 `.drawio`，以 `<mxlibrary>` 开头的那种）：其中是 SVG 图片的条目会带着标题和尺寸加进来。用 draw.io 自己的形状画的条目和位图（PNG、JPEG）读不了；面板会说明有几个没收、为什么。
- **从链接添加**：**Add library… → From a link…** 接受指向上面任一种文件的 `https://` 链接。页面读取后会先询问：显示来源网站、形状库名称、会添加和不收的形状数量，点 **Add** 之前什么都不保存。除非文件里自己写了来源，链接会记作形状库的来源。链接由页面直接从你的浏览器读取，不带 Cookie，也不带 Referer，不经过 Open Artifact。这要求对方网站允许别的页面读取这个文件（很多文件托管网站不允许），也要求白板所在的站点允许页面访问其他网站：自托管的 Open Artifact 站点默认不允许，除非用 `OA_PAGE_NETWORK=https` 运行（见 [托管](../hosting.zh-CN.md)），这时 **From a link…** 会说明在这里用不了。链接读不了时，把文件下载下来，用 **From a file…** 添加。
- **放置**：按名称或标签搜索，点一个形状，再点白板。它会以无边框图片的形式落下，下面带一个空的标签，在你输入文字前显示形状的名称。箭头可以像连接任何图片一样连到它上面。把 `.svg` 拖到白板本身（而不是面板）上，仍然按普通图片插入。
- **移除**：打开形状库的 **⋯** 菜单（这里也能看到来源和许可），选 **Remove from this board**。已经放好的形状会保留，因为每个放置的形状都带着自己的图形。

`.shapes.json` 文件长这样（`source`、`license`、`tags`、`w`、`h` 都可以不写）：

```json
{
  "format": "open-artifact-shapes",
  "version": 1,
  "name": "Cloud basics",
  "source": "https://example.org/cloud-basics",
  "license": "CC0-1.0",
  "shapes": [
    {
      "name": "Database",
      "tags": ["storage", "sql"],
      "w": 48, "h": 48,
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\"><ellipse cx=\"24\" cy=\"11\" rx=\"14\" ry=\"5\"/><path d=\"M10 11v26c0 3 6 5 14 5s14-2 14-5V11\"/></svg>"
    }
  ]
}
```

用 `currentColor` 画的图形会跟随白板的墨色，在浅色和深色主题下都清楚。

**哪些会被略过，为什么。** 每个形状在添加时都会先清理一遍，之后面板会告诉你加了多少个形状，并逐个列出被略过的形状和原因。图形用到白板图形不支持的东西时会被略过：文字（请先转成轮廓）、脚本、内嵌或外链图片、`<use>` 引用、除了包住整幅图以外的裁剪路径，以及普通 SVG 图形、分组和渐变以外的任何内容。没有尺寸的图形，或清理后超过 16,000 个字符的图形，也会被略过。超过 4 MB 的文件整个不收；超过 500 个形状时，后面的不再读取。这些限制让每个放置的形状都小巧、自包含，可以放心展示给白板上的每个人。

## Agent 怎么用

- **类型 ID**：`whiteboard`（`type_url: "open-artifact://type/whiteboard"`）
- **存储结构**：实时 JSON 文档库，位于 `<root>/db/`：
  - `db/board/meta.json` — 白板标题与元素叠放顺序。
  - `db/elements/<id>.json` — 每个白板元素一个文档（便利贴、图形、分区、文本、箭头、手绘、图片、表格、贴纸、计时器、链接卡片、嵌入网页）。
  - `db/board/shapes.json` — 用户添加的形状库（每个形状库的文件是一个上传文件 `_blobs/<id>.json`）；`context` 会以 `shapeLibraries` 列出它们。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/whiteboard/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/whiteboard", title, open: "after_first_write"}` | `open-artifact open <root> --type whiteboard --title "<标题>" --json` |
| 读取白板 | `ArtifactData {action: "list", url, collection: "elements"}` / `get` `board/meta` | `open-artifact read-db <root> [elements \| board/meta]` |
| 写入 / 批处理 | `ArtifactData {action: "batch", url, writes: [...]}`（`set`/`update`/`delete`；覆盖已有文档的 `set` 和 `delete` 要带 `if_match`） | `open-artifact write-db <root> '<writes>'`（支持 `{"$file":"..."}`） |
| 上传图片 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}`（返回的 `/_blob/<id>` 就是图片元素的 `src`） | `open-artifact upload <root> <file>...` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 查看视角/选中项 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. 用贴合主题的空间形态布局（循环用环形、跨团队流转用泳道、拆解用树状、对比用矩阵），避免千篇一律的方框网格。
2. 新建白板整体范围控制在约 `1500×750`，保证打开时缩放比例清晰可读；留足间距（相邻元素 24 px、箭头间距 64 px、带文字箭头 144 px）。
3. 尊重用户在白板上的手动修改：写前先重新读取，原地扩展而不在旁边另起一套副本，放大元素时同步平移相邻元素和附着贴纸。
4. 优先用 `ArtifactData` `batch`（单批最多 500 条写入）原子提交；在 `update` 中用 `{"__delete__": true}` 删除字段。
5. 只有在「有东西沿这条线在走」是重点时，才用 `"dash": true, "flow": true` 让箭头流动；它算白板上的一种标记，要在图例或标签里说明含义（只写 `flow` 不写 `dash` 时 `check` 会提示）。
6. 用 `#element=<id>` 链接同一白板上的元素（链接卡片、图片的 `href`，或文本里的 `[文字](#element=<id>)`），做目录或在大白板上串起一条路线；删掉元素时一并修改或删除指向它的链接（`check` 会提示）。
7. 白板有形状库（`context` → `shapeLibraries`）且其中有合适的形状时，把它作为普通 `image` 放上去，名称写在下方的 `text` 里，而不是自己画；不要手写 `board/shapes` 或形状库文件。

完整元素 schema、绘图与创意协作规范见 [artifact-types/whiteboard/SKILL.md](../../artifact-types/whiteboard/SKILL.md) 及 `artifact-types/whiteboard/reference/`。
