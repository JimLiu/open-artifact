# 运行时与更新

[English](runtime.md)

读完后你能在应用里附带 Open Artifact，知道多个应用各带一份时由哪一份启动 daemon，并选择它怎么更新。

## 运行时是什么

运行时就是 npm 包 `@open-artifact/cli` 的内容：`scripts/open-artifact.mjs`（命令行和 daemon），以及 `vendor/` 里的 Shell、类型服务器和内置类型。每个 Open Artifact 主目录（`~/.agents/open-artifact`，或 `OPEN_ARTIFACT_HOME`）只运行一个 daemon，电脑上所有应用共用。

## 附带一份

把运行时目录随应用一起发布，连接时指明它：

```js
const oa = await createHarness({
  harness: 'my-agent',
  runtime: { dir: '/Applications/MyAgent.app/Contents/Resources/open-artifact', version: '0.13.0', update: 'prompt' },
});
```

`hello` 会把它登记到 daemon（记在 `<home>/runtimes.json`），daemon 会把宿主带来的最新运行时复制到共享目录 `<home>/runtime/<version>/`，这样卸载你的应用不会让电脑退回到旧的 daemon。已登记但目录已不存在的运行时会被跳过。

示例用 [`examples/harness-node/harness.mjs`](../../examples/harness-node/harness.mjs) 里的 `hostRuntime()` 找到自己附带的运行时：已安装的 `@open-artifact/cli` 包，在本仓库里则是构建好的 skill，并读出它的版本。设置了 `OPEN_ARTIFACT_DAEMON_BIN` 时它什么都不返回；找不到运行时时它抛出错误。

不传 `runtime` 时，kit 在其他应用登记的运行时和共享运行时中选择。`OPEN_ARTIFACT_DAEMON_BIN`（一个 `open-artifact` 入口文件）会跳过选择。没有可启动的东西时，它抛出 `no_daemon`，修复提示是：`Set OPEN_ARTIFACT_DAEMON_BIN to the open-artifact entry, or pass bin (createHarness: runtime.dir).`

## 哪一份会启动

没有 daemon 在运行时，kit 会在你自己的、已登记的和共享的运行时中，启动 Harness API 版本与你兼容的**最新**一份；人设置了版本锁定时（`open-artifact runtime pin ^0.14`），只在锁定范围内选。版本相同时优先你自己的。正在运行的 daemon 比你自己的运行时旧时，会被替换。

kit 以 `<你的 Node 或 Electron> <runtime>/scripts/open-artifact.mjs daemon run` 的方式、在后台、带 `ELECTRON_RUN_AS_NODE=1` 启动它，所以 Electron 应用不需要另外的 Node。它的输出写到 `<home>/logs/daemon.out`；启动失败时抛出 `daemon_failed`，写明这个文件。

## 更新

| 策略 | daemon 的做法 |
| --- | --- |
| `prompt`（默认） | 每天最多检查一次注册表，并通知已订阅的适配器（`runtime/update` 事件）；在有人同意之前什么都不下载 |
| `auto` | 还会在后台下载 |
| `bundled` | 从不检查；只用这台电脑上已有的运行时 |

生效的策略按以下顺序，第一个匹配的为准：

1. **机器。** `OPEN_ARTIFACT_RUNTIME_UPDATE=off`，或一个内容为 `{"runtimeUpdate": "off"}` 的机器策略文件（`$OPEN_ARTIFACT_MACHINE_POLICY`，否则 `/Library/Application Support/Open Artifact/policy.json`、`/etc/open-artifact/policy.json`、`%ProgramData%\Open Artifact\policy.json`），会关闭检查和更新。
2. **人。** `settings.json` 的 `runtime.update`，用 `open-artifact runtime policy auto|prompt|bundled` 设置（`default` 删除它）。
3. **适配器。** 已登记运行时里最保守的 `update`；说 `bundled` 的适配器弃权，除非所有适配器都说 `bundled`。
4. `prompt`。

不带参数的 `open-artifact runtime policy` 打印生效的策略及其来源。

### 在你的应用里同意更新

```js
oa.on('event', (event) => {
  if (event.type === 'runtime/update' && event.available) offerUpdate(event.available);
});
// when the person agrees:
const { installed, pending, message } = await oa.runtime.update();   // or update('0.14.2')
const status = await oa.runtime.status();
```

`oa.runtime.status()` 的回答和 `open-artifact runtime status --json` 打印的一样：正在运行的版本、将会启动的那份、这里的每个运行时、策略及其来源、版本锁定、注册表、上次检查结果和待切换的版本。`oa.runtime.update(version?)` 安装最新的兼容运行时，或指定版本；人选了 `bundled` 或机器关闭了更新时，它会以 `not_granted` 拒绝。daemon 没列出功能 `runtime.update` 时，两者都抛出 `unsupported`（修复提示：`Update the Open Artifact runtime this computer runs.`）。

### 更新怎么校验

- 来源是 npm 注册表上的 `@open-artifact/cli`：`$OPEN_ARTIFACT_REGISTRY`，否则 `settings.json` 的 `runtime.registry`，否则通常的 npm 配置，否则 `registry.npmjs.org`。只有回环地址上的注册表可以用明文 `http`。
- 检查时不发送凭据、cookie，也不发送任何关于人或其作品的信息。它选择最新的、非预发布、未弃用、在锁定范围内、能在这个 Node 上运行、并且兼容最近见过的每个适配器的 Harness API 的版本。
- 压缩包的 sha512 必须与注册表的 `dist.integrity` 一致，否则拒绝。注册表的来源证明（provenance attestation）会被记录并由 `runtime status` 显示，**但不做校验**。
- 压缩包最大 256 MiB，解压后最大 1 GiB。保留三份共享运行时。
- daemon 在空闲时（没有打开的页面，没有正在运行的工具调用或长操作）切换到新运行时，或在下次启动时切换。更新记录写到 `<home>/logs/daemon.log`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `open-artifact runtime status [--json] [--check]` | 这里的运行时和将会启动的那份；`--check` 立即查询注册表 |
| `open-artifact runtime update [--version <x.y.z>]` | 安装最新的兼容运行时，或指定版本 |
| `open-artifact runtime pin <range> \| --clear` | 把运行时限制在一个版本范围内 |
| `open-artifact runtime policy [auto\|prompt\|bundled\|default] [--json]` | 打印或设置人的策略 |

`update`、`pin` 和 `policy` 由人决定：在 Agent 会话里运行会被拒绝。

## 新版本写过的作品

两个应用可能带着不同的运行时，人可能在旧运行时上打开一个被新版本类型写过的作品。这时工具会把它当作只读（[Agent 工具](tools.zh-CN.md#新版本写过的作品)）。

## 单文件可执行程序

对于既没有 Node 也没有 Electron 的应用，`open-artifact-<platform>-<arch>`（Windows 上是 `.exe`）就是内含运行时的 Node。它的命令行和 `open-artifact` 相同，所以你的应用随附它，运行 `open-artifact-darwin-arm64 harness --stdio --harness my-agent` 即可（[非 JavaScript 应用](non-node.zh-CN.md)）。

第一次使用时，它把运行时解压到共享目录 `<home>/runtime/<version>/`，像更新一样按 sha512 校验，然后从那里运行。这个目录是普通的共享运行时：电脑上更新的运行时仍可能被选中启动，由这个可执行程序的 Node 运行。它启动的 daemon 和类型服务器也运行在这个可执行程序上，所以电脑上不需要 `node`。

daemon 交给 Agent 的命令（skill 文本和工具回答里的）以这个可执行程序的路径开头，而不是 `node`，路径有空格或 shell 特殊字符时加引号（在 Windows 上因为有反斜杠，总是加引号）；`open-artifact doctor` 显示 `Node.js <version> (inside the single-file executable <path>)`。有两个限制：

- 在 PowerShell 里，带引号的程序路径必须用 `&` 调用（`& "C:\Program Files\My Agent\open-artifact-win32-x64.exe" …`）。daemon 的文本不会加 `&`，所以在 PowerShell 里运行这类命令的 Agent 得自己加。
- 这个可执行程序只在 macOS arm64 上构建和测试过。其他平台用同一个脚本构建，但没有测试过。

它还没有发布：请在你要发布的每个平台上自己构建。

```text
npm run build
node scripts/build-skill.mjs
node scripts/build.mjs --only sea      # dist/sea/open-artifact-<platform>-<arch>
```

构建它的 Node 就是它里面的 Node：nodejs.org 的官方构建，Node 25.5 或更高版本（用 `--node <path>` 或 `OPEN_ARTIFACT_SEA_NODE` 指定）。不带单文件可执行程序支持构建的 Node（例如 Homebrew 的）不能用。在 macOS 上，结果是临时签名（ad hoc）的；发布前请用你自己的身份签名。
