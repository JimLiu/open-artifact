# Desktop TypeScript 开发

桌面应用单独管理依赖和锁文件，不属于根目录的 npm workspace；根目录的类型检查和单元测试不会覆盖它。
开发需要 Node.js 22.18 或更新版本。

先从仓库根目录构建运行时，再安装和检查桌面应用：

```bash
npm run build
node scripts/build-skill.mjs
cd apps/desktop
npm run setup
npm run check
```

- `npm run typecheck` 检查全部 TypeScript 源码：主进程、三个沙箱 preload、React 页面、独立通知与状态页面、
  构建与打包脚本、测试辅助代码、开发版测试和打包版测试。
- `npm test` 重新构建应用，依次运行开发版测试。每个测试使用独立的配置目录和端口。
- `npm run check` 先运行严格类型检查，再运行 `npm test`。
- `npm run package` 构建并签名本地 macOS 应用；打包完成后运行 `npm run test:packaged`。
- `npm run package:release` 生成 Developer ID 签名、公证的 ZIP / DMG；`npm run test:release` 无需 Apple 凭据即可
  检查发布验证逻辑。见[签名与 GitHub Actions 发布](RELEASING.zh-CN.md)。

`tsconfig.json` 继承仓库的严格类型配置，并开启 `erasableSyntaxOnly`。Node 直接运行 `.ts` 脚本和测试，
源码导入使用 `.ts` / `.tsx`。Esbuild 将主入口生成为 `out/main.mjs`，沙箱 preload 生成为 `out/*.cjs`，
页面脚本生成为浏览器 `.js`；Electron 只加载这些构建产物。`out/`、`resources/` 和 `dist/` 均为生成目录，
不参与类型检查。

`src/contracts.ts` 统一定义 `window.desktop`、`window.artifactApp`、`window.notice` 及 IPC 请求与响应的类型。
`src/ipc.ts` 检查主进程处理器的签名并验证调用来源；`src/ipc-client.ts` 将 Electron 无类型的请求传输限制在
一个适配器内。页面的全局对象声明位于 `renderer/globals.d.ts`。`src/installed-app-types.ts` 定义安装日志、
原生操作以及通过状态字段区分的安装状态。测试中的 CDP 命令和事件使用 `devtools-protocol` 的协议映射类型。

扩展应用时，应在这些契约中补充具体字段和状态分支。保留 IPC 参数、磁盘文件和子进程数据的运行时校验；
`unknown` 用于这些输入边界及泛型辅助函数。不要使用 `any`、通用动态类型别名或 TypeScript 忽略注释替代业务模型。
