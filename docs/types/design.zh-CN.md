# Design（设计画布）

[English](design.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Design** 是一个由 WebGL2 驱动的无限画布，承载以本地文件保存的实时 `.dc.html` 画板（Design Components）。适合 UI 界面设计、落地页多方案对比、App 流程稿、可点击交互原型、精致图表、海报传单与印刷排版。

> **什么时候不用 Design：** 不适合按页放映的演示文稿（请用 [Slides](slides.zh-CN.md)），也不适合自由发散的便利贴白板协作（请用 [Whiteboard](whiteboard.zh-CN.md)）。

## 核心功能

- **无限多页面画布**：并排摆放多个画板，支持最多 40 个画布页面（pages），并可添加分区大标题、便签、图形、箭头和手绘标注。
- **实时 `.dc.html` 画板与可点击原型**：画板由真实的 HTML/CSS/JS 实时渲染；启用 `is_interactive: true` 后可点击 **Play** 进入可交互原型运行模式。
- **多端响应式预览与长图导出**：在 Play 模式下切换 Fill/Fit 以及手机（`390`）、平板（`768`）、`1024`、`1280`、`1440`、`1920` 等宽度，并可按所选宽度导出 1× 或 2× 完整长图 PNG。
- **直接可视化编辑**：直接在画板上改文案、移动缩放画框、调整颜色与文字样式、并排对比多套视觉方案。
- **深度集成设计系统**：安装 [Design System](design-system.zh-CN.md) 后，品牌色与文字样式会接入编辑器选择器，还可以直接挂载设计系统导出的真实组件包（`window.<Ns>`）。
- **打印与分页排版**：支持 Letter / A4 纸张及流式分页（`print: "flow"`），导出规范的多页打印 PDF。
- **丰富的导出方式**：
  - **PNG / JPEG**（单画板或按预览宽度导出的 1×/2× 整页长图）
  - **PDF**（固定画幅或自动分页打印）
  - **HTML** — 独立网页、**Figma 采集专用 HTML**（在 Chrome 打开后用 Figma 插件一键采集），或 **Entire project (.zip)**（项目的全部文件连同 `canvas.json`、上传的素材、运行时、索引与 README；以点开头的隐藏文件不打包，项目太大时分成几个编号的 zip，没打进去的文件 README 里都列出来）。单文件 HTML 会把画板用 `@import` 引入的样式表一起嵌进去；铺满窗口的页面如果画框比内容高出一大截，导出时会提示文件末尾留了多少空白。

## 用户怎么用

### 创建设计画布
```text
/open-artifact design 给精品咖啡烘焙品牌做三套不同风格的落地页方案
/open-artifact design 移动端注册引导流程（4 个界面），带可点击 Play 原型
/open-artifact design 用我们的品牌设计系统做一张 A4 大会海报
```

### 编辑、预览与导出
- **浏览与修改**：自由平移缩放画布、移动画板、点击文字直接改写，或在侧边栏切换画布页面。
  缩放时，画板标题和标题旁的按钮保持原来的大小。双击标题，或者右键点选中的画板选 **Rename**，可以给画板改名：按 **Enter** 保存，按 **Escape** 取消。标题不在屏幕上时，画布先把它移进视野，缩放比例不变。
- **移动视图**：滚轮或触控板双指滑动平移，**⌘ + 滚轮**（Ctrl + 滚轮）或双指捏合以指针为中心缩放。按住鼠标**右键**或**中键**拖动，或按住**空格**拖动，都能平移画布；右键拖动不改变选中、也不弹菜单，右键单击不动仍然打开右键菜单。**⌘0** / **⇧1** 适配整张画布，**⇧2** 缩放到选中内容。
- **锁定与排列**：按 **⌘L**（Ctrl+L）锁住画板、便签或元素，免得误移、误改大小或误删；同样按一下或在图层列表里解锁。页面可以用 **Move up / Move down** 或在页面列表里拖动调整顺序；**⌘]** / **⌘[** 上移或下移一层，**]** / **[** 或 **⌥⌘]** / **⌥⌘[** 移到最前或最后；画板也能这样调整层叠。删除时跳过锁住的便签和画板，全部锁住才拒绝。
- **选中、复制与对齐**：按住 Shift 点选，或拖出选框，可以把画板、便签和元素一起选中（显示 **N selected**），一起拖动，撤销时算一步。拖动时按住 **Alt** 就变成复制（拖到一半按下或松开 Alt 可以来回切换，**Esc** 取消）；画图形时按住 **⌘**（Ctrl）不吸附。选中元素后，**⌥A** / **⌥H** / **⌥D** 左对齐、水平居中、右对齐，**⌥W** / **⌥V** / **⌥S** 顶对齐、垂直居中、底对齐（选了几个就彼此对齐，只选一个就对齐父元素）。**⌥⌘C** / **⌥⌘V** 复制一个对象的样式，再粘到别的对象上。
- **画布和画板之间挪东西**：选中一个画板再粘贴，复制的便签或图层会作为定位图层放进画板。把便签或碎片拖到画板上（画板会亮起来），它就按落点插进版面；按住 **Ctrl** 则原地放下、保持位置。把元素拖出画板、放到空白画布上，它会变成一块没有边框的碎片；在图层列表里把一行拖到另一个画板的行上，元素就挪到那个画板里。双击画板里的路径可以逐点编辑。
- **在画板里画**：用 **Text**、**Rectangle**、**Oval**、**Line**、**Arrow** 或 **Pencil** 在画板上按下去，画出来的东西会作为定位元素写进画板的页面（灰色的占位填充或描边），画完就选中它，方便接着改样式。点一下得到默认大小，按住 **Shift** 画正方形或 45° 的线；按下的点会吸附到画板及其顶层区块的边线和中线（按住 **⌘** / Ctrl 不吸附）。画板里有元素选中时，画的东西改为放进指针下的区块（需要时把它设为 `position: relative`），**Artboard** 工具也在那里加一个框，而不是新建画板。新文字一出来就进入编辑，*Your text here* 已全选；留空退出，它就自动删掉。每画一次，**⌘Z** 一下就撤回。
- **跨文件一起操作**：选中不同画板里的元素（可以同时选着便签和画板）时，**⌘C** 复制、**⌘X** 剪切的是这些元素，撤销时算一步；便签和画板不跟着复制，剪切后仍然选着。**⌘V** 把元素各自粘回原来的画板。选中的元素里有锁住的，剪切会被拒绝。**⇧X** 对调填充和描边、**X** 去掉填充，对所有成员一起生效，各算一步撤销。属性面板只显示所有成员都有的行，值不同的显示 **Mixed**（悬停提示 *Mixed across the selection*）；选中里有便签或画板时 Position 不可用。选中几个画板时，在数字框里输入 `+4`、`-2` 会在各自原值上增减；参考线只有各画板一致时才能改。
- **键盘操作图层列表**：整个列表只占一个 Tab 位。**↑** / **↓**、**Home** / **End** 在行间移动，并在画布上圈出对应图层；**→** / **←** 展开或收起一行（或进入、退出子行）；**Enter** 或 **Space** 选中（**⇧** / **⌘ Space** 追加）；**F2** 重命名，按 **Enter** 或 **Esc** 回到这一行。编组、取消编组或把一行拖到别的父级后，如果图层改成按位置摆放，它会停在原处，并保留在原容器里的样子；仍按流式排列的图层照原样移动。
- **图形样式**：矩形和椭圆可以在属性面板里设置填充、描边（放在边线 **Inside**、**Center** 或 **Outside**）、圆角和透明度；新画的矩形（画布上或画板里）沿用在这个文件里上次设的圆角。图片便签可以设边框、圆角、阴影、滤镜，以及图片在框里怎么摆放。
- **便签快捷条**：选中便签或标题，快捷条上有 **Text style**（Sticky 或 Title，大小从 Small 到 Huge，也可以自己填 px）、**Ink**（字的颜色）、**Bold** 和 **Italic**；便签还有 **Fill color**，设纸的颜色。矩形和椭圆有 **Fill color**，线、箭头和手绘有 **Stroke** 和 **Line style**（实线、虚线、点线），链接卡片有 **Open**。在便签里打字时快捷条也在：**Bold**、**Italic** 给选中的字（没选就是光标所在的词）加上或去掉 Markdown 标记，**List** 把选中的几行变成无序或有序列表，按 **Esc** 结束打字。视频便签的快捷条一直有 **Properties**，点它打开面板并切到 Properties 页。只读的时候（查看者或评论者的链接），选中便签、元素都不显示快捷条。
- **裁切和视频**：双击图片便签（或按它快捷条上的 **Crop**）开始裁切：拖边缘裁掉一部分，拖图片移动位置，⌘/Ctrl 加滚轮或 **+**/**−** 缩放，方向键微调；**Enter** 或 **Esc** 保留裁切，裁切中按 **⌘Z** 放弃。把视频（.mp4、.webm 或 .mov，不超过 20 MB，一次最多四个）拖进或粘贴到画布上，就成了视频便签：显示一帧封面，点一下播放，同时最多播四个。在 **属性 → Media** 里可以换成另一个视频、设置或重置封面、拖动查看某一刻，开关 **Autoplay**、**Loop**、**Sound**。拖进画板的视频会变成页面里的 `<video>`。能编辑的时候，选中便签或元素，快捷条上有 **Comment**，点它就在这里开始评论；图形、图片、视频和链接卡片的快捷条还有 **Lock**。
- **元素样式**：属性面板里，网格的 **Columns** / **Rows** 填数字就是几等分（也可以写任意轨道列表），子项可以设跨几列几行和最小、最大尺寸；边框分样式、颜色和宽度（统一一个值，或每边单独设）；文字颜色可以是纯色，也可以是透过文字显示的 **Gradient** 渐变。边框可以放在边线 **Center** 或 **Outside**，有子元素贴着那条边时盒子位置不变，按钮和链接会得到一圈画在外面的焦点环。**⌥⌘V** 粘到画板上会设置它的页面背景（从另一个画板复制来的还带上圆角）。双击组件实例里没法就地改的文字，会提示这段文字是实例的某个 prop 设的，还是组件本身写死的。
- **运行原型**：点击工具栏 **Play** 按钮体验交互原型并切换不同屏幕宽度。
- **向 Agent 提修改意见**：在画板上锚定评论，点 **Send to agent**。
- **实时更新**：Agent 写的文件会直接出现在画布上。连接断开期间的改动，会在重新连上后合并进来，画布位置、选区和 Ask 草稿都不变。
- **修复报错**：画板运行出错时，下方会出现提示条，点 **Ask agent to fix** 交给 Agent 修；右上角的 **N errors** 列出本页所有出错的画板，可以一次让 Agent 全部修好。用 **×** 关掉提示条后，画板名旁会留一个警告标记，点它就能把提示条找回来。Agent 连不上时，请求会留在这个列表里，供你复制到它的对话中。
- **直达链接**：在 URL 后附加 `#artboard-<name>`、`#play-<name>` 或 `#page-<id>` 直接定位到指定画板或页面。
- **导出**：打开 **Share → Export** 导出 PNG、JPEG、PDF、Figma 采集 HTML 或打包整个项目的 ZIP。

### 用的是 Gemini 模型？

用 Gemini 模型时（在 [Antigravity](../../plugins/antigravity/README.md) 或其他应用里），建议给 Design 搭配 Google 的 [`gemini-frontend-design`](https://github.com/google-gemini/demolab/blob/main/skills/gemini-frontend-design/SKILL.md) skill：它负责视觉方向、配色、字体、布局和动效，Design 自带的 skill 负责画布怎么写。Open Artifact 不附带这个 skill，请按 [`google-gemini/demolab`](https://github.com/google-gemini/demolab) 仓库 README 的说明安装（只装这一个：`npx skills add google-gemini/demolab --skill gemini-frontend-design`）。没装也能正常用：Agent 开始设计前会提一次这个链接，方便你先装上；你不说话它就照常往下做。

## Agent 怎么用

- **类型 ID**：`design`（`type_url: "open-artifact://type/design"`）
- **存储结构**：项目文件位于 `<root>/project/`：
  - `project/canvas.json` — 索引文件（`v: 3`、`createdOnFiles`、`title`、`launch`、`pages`、`boards`、`order`、`notes`、`designSystems`）。
  - `project/<path>.dc.html` — 每个画板对应一个 `.dc.html` 文件（入口通常命名为 `Main.dc.html`，画框宽高 40–8000 px）。
  - `project/ds/<folder>/` — 安装设计系统时复制的 `tokens.json`、`tokens.css`、组件包、字体与素材。
- **限制**：单个画布最多 512 个文件、总计 256 MB；`canvas.json` 小于 1 MiB。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/design/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/design", title, open: "after_first_write"}` | `open-artifact open <root> --type design --title "<标题>" --json` |
| 写入画板 | 用文件工具写 `<root>/project/canvas.json` 和 `*.dc.html`（或带 `if_match` 调用 `Artifact publish`） | 直接写入 `<root>/project/` |
| 上传素材 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}` | `open-artifact upload <root> <file>...` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 查看选中项 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. 设计前先检查是否已有可复用的 `design-system`；如果它包含组件包（`window.<Ns>`），必须挂载其真实组件而不要手写仿制品，并将其文件复制到 `project/ds/<folder>/`。
2. 先写 `project/canvas.json` 和第一个画板并展示页面，之后按 `order` 顺序**每轮只写一个画板**，让用户清晰看到每个画板逐步落地。
3. 图片、字体等素材必须通过 `upload` 上传为 `/_blob/<id>`，禁止使用 `data:` URI 或裸文件名。
4. 完成后运行 `check` 并修复所有报错（如缺失 `support.js`、`$preview` 尺寸不匹配、无效 `/_blob/` 引用或过期的设计系统副本）。
5. 用 Gemini 模型时，如果会话里已加载 `gemini-frontend-design` skill，就用它来定视觉；文件怎么写、图片怎么进画布、要检查什么，仍以 Design skill 的规则为准。没加载时，在开始设计前提一次它的链接（本来就要提问时，把它并进那一轮问题；否则说一句就直接开工，不等回复），没人要求就不要自行安装。

完整 `.dc.html` 语法、布局、着色器与打印参考见 [artifact-types/design/SKILL.md](../../artifact-types/design/SKILL.md) 及 `artifact-types/design/reference/`。
