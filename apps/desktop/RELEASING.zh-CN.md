# macOS 签名与发布

[English](RELEASING.md)

Open Artifact Desktop 的 macOS Apple Silicon 正式包使用 Developer ID 签名、Hardened Runtime、Apple 公证和
staple 票据，交付 ZIP 与同样签名、公证、staple 的 DMG。固定 Bundle ID 为 `dev.openartifact.desktop`。
桌面应用、lockfile 与包内 runtime 共用版本号。正式签名版从 GitHub 检查桌面更新，runtime 的更新另行处理。
用户在自己 Mac 上创建的作品应用仍使用本地临时签名。

## 签名材料

需要 **Developer ID Application** 证书及匹配的私钥，导出为密码保护的 `.p12`，包含 Developer ID 中间证书。
Apple Developer 网站下载的 `.cer` 只有公共证书，不能单独签名。加密 `.p12` 与私钥备份放在仓库外，密码单独
保存在钥匙串或密码管理器中。把备份导入临时钥匙串并实际签署可执行文件，验证它确实可恢复。

本机配置将加密材料保存在 `~/.open-artifact-release/signing/`，清单记录证书、Team ID 及密码在钥匙串中的
service/account。还需另存一份安全备份，才能在另一台 Mac 恢复。私钥、`.p12`、`.p8`、密码、钥匙串数据库
不能提交到 git，也不能作为发布附件或 Actions artifacts 上传。

查看公开的签名身份：

```bash
security find-identity -v -p codesigning
```

公证凭据可用 Apple 账户加 **App 专用密码**，或团队的 App Store Connect API key。
Apple 账户的日常登录密码不能用于公证。以交互方式配置本机 profile：

```bash
xcrun notarytool store-credentials open-artifact-notary \
  --apple-id '<Apple 账户>' --team-id '<TEAM_ID>'
xcrun notarytool history --keychain-profile open-artifact-notary
```

团队 API key 则改用 `--key /安全路径/AuthKey_<KEY_ID>.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>`。
不要把密码写进粘贴到聊天或日志中的命令。

## GitHub 配置

在仓库创建 **`macos-release`** Environment，只允许 `main` 分支与 `desktop-v*` tags，配置：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `OA_MAC_CERTIFICATE_BASE64` | Secret | 加密 `.p12` 的 Base64 |
| `OA_MAC_CERTIFICATE_PASSWORD` | Secret | `.p12` 密码 |
| `OA_MAC_SIGNING_SHA1` | Variable | 证书完整 SHA-1，40 位大写 hex |
| `OA_APPLE_TEAM_ID` | Variable | 10 位 Apple Team ID |
| `OA_NOTARY_APPLE_ID` | Secret | 用于公证的 Apple 账户 |
| `OA_NOTARY_APP_PASSWORD` | Secret | 该账户的 App 专用密码 |

也可以用 `OA_NOTARY_API_KEY_BASE64`、`OA_NOTARY_KEY_ID`、`OA_NOTARY_ISSUER_ID`（团队 API key）替代两个
Apple 账户 Secret。只配置一种公证方式。Secrets 仅传入凭据准备步骤：证书导入临时钥匙串，实际签名并运行探针，
核对完整指纹与 Apple 访问权限，然后建立临时 `open-artifact-notary` profile。钥匙串密码每次随机生成。
独立的 `always()` 步骤在成功或失败时恢复搜索列表，清理临时凭据。

先在 `main` 上手动运行 **Desktop macOS** 工作流的 `mode=validate`，只验证凭据，不打包或发布。
工作流进入 `main` 后可运行：

```bash
gh workflow run desktop-macos.yml --ref main -f mode=validate
gh workflow run desktop-macos.yml --ref main -f mode=package
```

所有模式都先校验 tag 输入，检出后确认提交在 `origin/main` 上，再执行仓库代码、访问签名凭据。
`package` 构建并测试 runtime 与桌面应用，签名、公证 App 和 DMG，只上传 ZIP、DMG、两份 `.sha256` 与
`release.json`、`desktop-updates-darwin-arm64.json` 到 `open-artifact-desktop-macos-arm64` Actions artifact，
保留 14 天，不创建 GitHub Release。
使用原生 arm64 `macos-15` runner；生成的 WASM 已提交，不需要重编 Rust/WASM。

## 发布

1. 桌面端 `package.json` / `package-lock.json` 随 runtime 和其他包一起升级版本。写好对应的 `CHANGELOG.md`
   条目，运行 `node scripts/changelog.mjs --check <版本>`。
2. 将已验证的源码提交并推送到 `main`，给该提交打 `desktop-v<MAJOR>.<MINOR>.<PATCH>` tag 并推送。
   只接受不带前导零的稳定版本。tag 版本必须匹配应用、lockfile 与 runtime，提交必须在 `origin/main` 上。
3. tag 自动触发 **Desktop macOS** 的 `publish` 模式。也可手动发布一个已有的桌面 tag：

```bash
gh workflow run desktop-macos.yml --ref main -f mode=publish -f tag=desktop-v<VERSION>
```

两种入口都从 tag 构建、执行桌面检查，先给 App 公证并 staple 再归档；解开 ZIP 复验签名、证书指纹、票据与
Gatekeeper；单独给 DMG 签名、公证、staple；测试正式签名的桌面包和作品应用。
URL scheme 声明仍由现有的 `OA_DESKTOP_URL_SCHEME=1` 打包选项显式启用。

独立 publisher 不接触 Apple Secrets。它核对源码、签名身份和文件摘要，创建草稿、上传并下载对比每个附件，
公开发布后再次匿名下载校验。桌面 tag / Release 与 npm 的 `v*` 工作流独立，不改变 GitHub 既有 Latest。

既有附件不可变：失败后只重跑 **publish job**，复用同一次构建的 artifact。同名文件字节不一致会拒绝继续，
部分上传的草稿也一样。需要重新构建不同内容时，使用新的版本/tag。
`release.json` 记录源码提交、签名身份、Apple submission ID 与 SHA-256。

## 桌面应用自动更新

正式打包在签名包的元数据中写入 `desktopUpdates: true`，并从最终公证 ZIP 生成
`desktop-updates-darwin-arm64.json`。这份静态 Squirrel JSON 清单包含稳定版本、GitHub ZIP 地址、字节数和
SHA-256。publisher 核对清单与 ZIP 一致，并将其纳入全部上传和公开下载校验。不需要维护分支上的可变清单、
搭建更新服务器或修改 GitHub Latest。

应用启动 15 秒后检查公开的 `JimLiu/open-artifact` GitHub Releases API，此后每 6 小时检查一次，选择比当前
版本更高、同时具备已上传 arm64 ZIP 和清单的最高稳定 `desktop-v*` 版本。跳过草稿、预发布、npm tag 和没有
更新清单的旧 Release。API 或清单出错会显示可重试的错误。设置 → 桌面应用更新，以及应用菜单中的“检查应用更新”
提供手动检查。有更新时，侧边栏左下角“设置”右边出现“更新”按钮；没有更新时不显示。点击即开始下载，并打开更新窗，
显示实际下载字节计算的进度条、百分比和已下载／总 MB。“取消下载”停止远程传输，关闭窗口则让下载在后台继续。
自动检查默认开启，自动下载默认关闭。偏好保存在应用自身的 `<userData>/settings.json` 中，字段为
`appAutoCheck`、`appAutoDownload`，独立于 runtime 的更新策略。

Chromium 下载 ZIP 并报告进度，核对精确字节数和 SHA-256；带随机凭据路径的本机回环端点只把已验证的 ZIP 交给
Electron 原生 macOS 更新器，再次校验完整性和代码签名，通过后才报告就绪。就绪后在正常退出时安装，也可以选择“重启并更新”。
重启前会经过现有的等待保存和未保存内容确认；取消后仍保留就绪的更新。开发版、本地临时签名包、不支持的平台和
测试模式都不检查或安装。没有更新器的旧版需要手动下载一次已支持更新器的新版本。更新器本身无需 GitHub token
或新增签名密钥。

[2026-11-25 的真实签名演练](https://github.com/JimLiu/open-artifact-update-drill-20261125-a1cd84/blob/main/verification.json)
验证了匿名 GitHub 下载、实际字节进度、取消与半截文件清理、错误 SHA-256 和损坏代码签名的拒绝、未保存内容确认时
取消安装、恢复待保存内容、原生重启安装以及文档保留。安装后的字节、签名、staple 票据与 Gatekeeper 校验均匹配
已公证目标。演练使用独立仓库、Bundle ID 和配置目录，版本仅供测试，与正式发布分开；测试模式仍不能检查或安装更新。

## 本机打包与检查

先在仓库根构建 runtime：

```bash
npm run build
node scripts/build-skill.mjs
cd apps/desktop
npm run setup
npm run package                  # 本地临时签名 .app；无需公证凭据
npm run test:release             # 发布验证单测，不访问 Apple
```

正式打包时设置 `OA_MAC_SIGNING_SHA1`、`OA_APPLE_TEAM_ID`、`OA_NOTARY_PROFILE`，可选 `OA_MAC_KEYCHAIN`
指定保存身份与 profile 的独立钥匙串。先提交源码（正式打包要求干净工作区），再顺序运行
`npm run package:release`、`npm run test:packaged`。
公开文件在 `dist/release/`；公证失败时，结果和拒绝日志留在 `dist/notary-*/`。
缺少凭据、公证拒绝或签名/Gatekeeper 检查失败都会阻止发布，不回退到临时签名。

参考：[Electron 签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)、
[Apple App 专用密码](https://support.apple.com/102654)、
[GitHub macOS runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。
