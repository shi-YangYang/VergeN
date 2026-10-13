<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="VergeN" width="128" />
  <br>
  VergeN — 客户端与自托管运维面板
  <br>
</h1>

VergeN 是基于 [clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)(GPL-3.0)二次开发的企业 VPN:桌面端基于 [Tauri 2](https://github.com/tauri-apps/tauri) 与 Rust,移动端为 Android 自研客户端(Clash Meta for Android fork),内核均为 [mihomo(Clash Meta)](https://github.com/MetaCubeX/mihomo);配套一个用 Go 写的运维面板,负责账号、订阅、公告与版本分发。

## 客户端特性

- 内置 mihomo 内核,支持切换 `Alpha` 版本内核
- 简洁美观的用户界面,支持自定义主题颜色、代理组/托盘图标以及 `CSS Injection`
- 配置文件管理和增强(Merge 和 Script),配置文件语法提示
- 系统代理和守卫、`TUN(虚拟网卡)` 模式
- 可视化节点和规则编辑
- WebDav 配置备份和同步
- 企业模式:
  - 钉钉扫码登录,账号由组织统一管理
  - 订阅等敏感配置 AES-256-GCM 加密落盘
  - 公司下发的订阅锁定为只读:不可编辑、复制、二维码分享;卡片不暴露流量/到期信息
  - 心跳保活(在线人数/版本分布看板),服务器变更订阅后自动重新拉取
  - 一键退出登录(服务器侧 token 吊销 + 本地会话清除)
  - 应用内自动更新:从自建更新服务拉取安装包并校验签名后静默安装

## Android 客户端

- 基于 [Clash Meta for Android](https://github.com/MetaCubeX/ClashMetaForAndroid) fork,应用名 `io.github.vergen.android`
- 企业能力:登录闸门(密码/钉钉扫码)、订阅 bootstrap(自动创建+激活)、5 分钟心跳、AndroidKeyStore 加密会话、崩溃兜底落盘
- 受管订阅由服务端统一推送;本地仅可删除或启动,更新由系统按 config_version 自动完成
- 本地构建(JDK 21):

  ```shell
  cd android
  ./gradlew :app:assembleAlphaRelease
  ```

  产物在 `android/app/build/outputs/apk/alpha/release/`。

## 运维面板特性

部署在服务器上(单二进制,面板内嵌为静态资源),浏览器访问 `/admin`:

- 员工账号管理:创建、停用、重置密码、绑定钉钉 UnionID
- 订阅管理:增删改、启停;客户端通过心跳拉取
- 公告管理:逐用户认领、可撤回
- 策略管控:锁定端口/外部控制器等敏感设置
- 版本发布:多版本管理(Windows / macOS / Linux / Android),客户端弹窗提示与一键更新
- 公开下载页与登录/下载中转页
- 健康检查 `/healthz`,在线人数与版本分布看板

## 仓库结构

- `src/` — 客户端前端(React)
- `src-tauri/` — Tauri 客户端(Rust)
- `android/` — Android 客户端(CMFA fork,Kotlin;mihomo 内核以 submodule 引入)
- `server/` — 运维服务(Go)与面板前端(`server/web`,React,构建产物内嵌)
- `crates/` — 客户端附属 Rust 组件(内核管理、国际化等)

## Release(CD)

在 GitHub Actions 中手动运行 Release 工作流,选择 `main` 分支即可,无需填写客户端版本号。CD 只有两个任务:构建 Linux amd64 运维服务(包含管理面板),然后部署并重启服务。客户端安装包由独立工作流或本地构建,不再由 CD 构建或上传。推送 tag 不会触发部署,服务器 CD 也不创建 GitHub Release。

配置 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY` secrets 后即可部署。部署账号需要免密 sudo;可选 secrets 为 `DEPLOY_SSH_PORT`(默认 22)、`DEPLOY_PORT`(服务监听本机端口,默认 8080)。服务通过已有 Caddy 配置对外提供访问。服务器程序 SHA256 未变时跳过上传,已有数据库、安装包和发布记录保留。

## GitHub 客户端打包

合并到 `main` 后,在 Actions 手动运行 `Client packages (draft)`,选择 `main`,填写:

- `tag`:未使用过的版本,例如 `v0.1.1`;所有安装包内部版本统一为 `0.1.1`。
- `android_version_code`:高于所有已分发 APK 的整数版本代码;换工作流也不能从 1 重新开始。
- `signed_updates`:需要桌面客户端内更新时勾选;默认仅生成下载安装包。

工作流并行构建 Windows x64 EXE、macOS arm64 DMG、Linux x64 DEB 和 Android arm64 APK,直接上传到对应版本的 **Draft Release(草稿)**。每个版本保留独立草稿,不会自动发布、上传客户端 Actions artifacts 或传包到服务器。在仓库 Releases 中登录下载草稿附件,再到运维面板「客户端发布」上传即可。全部构建任务成功后再分发安装包;某个平台失败时,草稿可能只有部分附件。

同一版本、相同源码提交、Android versionCode 和签名模式可以重跑,补齐或替换对应安装包。换了源码、版本代码或 `signed_updates` 设置须使用新版本,避免一份草稿混入不同批次的包或失效签名。已有 Git tag、已发布 Release、未记录签名模式的旧草稿或来源不一致的草稿会被拒绝,工作流不会把公开 Release 改回草稿。

需要沿用仓库变量 `VITE_ENTERPRISE_SERVER_URL`,以及现有 Android 正式签名 secrets: `ANDROID_KEYSTORE_BASE64`、`ANDROID_SIGN_STORE_PASSWORD`、`ANDROID_SIGN_KEY_PASSWORD`(密钥 alias 为 `vergen`)。缺少配置会在开始构建前停止,不会退回 debug 签名。勾选 `signed_updates` 时还需要 `TAURI_SIGNING_PRIVATE_KEY`,以及密钥有密码时的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;该密钥必须与已安装客户端内置的公钥匹配,不要重新生成或替换。普通安装包构建不需要 Tauri updater 私钥。

启用签名更新后,草稿还会包含 Windows EXE 和 Linux DEB 的同名 `.sig`,以及 macOS 的带版本号 `.app.tar.gz` 与同名 `.sig`。DMG 用于首次安装,macOS 客户端内更新使用 `.app.tar.gz`。Linux 仅生成 DEB 安装包,在线更新使用该 DEB 及其同名 `.sig`。

构建产物按系统、架构和用途使用中文命名,例如 `VergeN_0.1.1_苹果电脑_ARM64_安装包.dmg` 和 `VergeN_0.1.1_苹果电脑_ARM64_升级包.app.tar.gz`。Windows 和 Linux 标为「安装及升级包」,Android 标为「安卓」;签名文件始终为对应包名加 `.sig`,文件内容保持不变。GitHub 会改写中文附件名,因此草稿列表使用中文显示名,实际下载文件名使用英文;本地构建产物和运维端均支持中文文件名。不额外生成 ZIP。

草稿及附件仅供拥有仓库写入权限的维护者访问;保持草稿状态,不要点击 Publish release。公开仓库的构建日志和输入版本号仍可能公开。运维下载页 `/download` 仍是公开页面,上传到该页面即对外提供下载。

## 本地构建与安装包管理

先同步客户端版本,再构建需要的平台:

```shell
pnpm release-version 0.1.1
pnpm package:desktop 0.1.1
pnpm package:android 0.1.1 9
```

`release-version` 会修改仓库中的客户端版本文件。桌面命令构建当前系统和架构的安装包:macOS 上生成 DMG,Windows 上生成 EXE,Linux 上仅生成 DEB;Windows x64 和 Linux x64 安装包应在相应环境构建。Android 命令仅生成 arm64 APK,最后的 `9` 是版本代码示例,正式发布必须使用高于已发布版本的代码。

产物统一放在 `release-local/<版本>/desktop/` 和 `release-local/<版本>/android/`。本地构建配置放在不提交的 `.env.build.local`,用于指定服务端地址、Java 和 Android SDK 路径。构建沿用已有 Android 签名配置,不要更换已发布应用的签名密钥或包名。需要桌面客户端内更新时,设置 `VERGEN_BUILD_UPDATER=true` 和上述 Tauri 签名环境变量,再运行 `pnpm package:desktop`。

登录运维面板,进入「客户端发布」,按以下顺序操作:

1. 填写与安装包一致的版本号和更新说明。
2. 为本次发布的平台上传或选择已有安装包。支持 `.dmg`、`.pkg`、`.exe`、`.msi`、`.deb`、`.rpm`、`.AppImage` 和 `.apk`,单个文件最大 512 MiB。
3. 如需桌面客户端内更新,勾选在线更新,选择各平台更新文件及同名 `.sig`;签名文件只需选择,无需填写链接或 JSON。未配置的平台使用下载安装,Android 目前仅支持下载安装。
4. 点击「发布版本」,版本说明、下载链接和在线更新配置一起生效。客户端发现更高版本后提示更新,用户点击后下载、验证签名并安装。

发布记录集中显示在下方,公共 `/download` 页按版本展示。上传本身只准备文件,不会创建版本或向客户端推送更新;未关联版本的安装包仍可在下载页折叠区域找到,文件链接也公开可访问。文件管理收在折叠区域,已被版本引用的文件不能删除;先删除相关版本再清理文件。删除最新版本会恢复上一条发布记录的在线更新配置。同名文件不覆盖,请使用包含版本号的文件名。在线更新的正式服务地址应为 HTTPS。

安装包保存在 `/var/lib/vergen/downloads`;CD 会为服务账号准备该目录的写入权限。已有手动填写的版本链接继续显示,发布新版本时会同步替换在线更新配置。

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more details.

To run the development server, execute the following commands after all prerequisites for **Tauri** are installed:

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

`pnpm dev` preserves the Development Channel's installed service state: an
existing service is used, while a previously uninstalled service remains
uninstalled and the app starts in Sidecar mode. Use `pnpm dev:service` to
explicitly install or update the isolated development service before launch,
or `pnpm dev:sidecar` to force the unprivileged Sidecar workflow.

运维服务本地启动:

```shell
cd server
go build -o vergen-server ./cmd/server
./vergen-server --add-admin 用户名:密码
```

## Contributions

Issue and PR welcome!

## Acknowledgement

Based on or inspired by these projects and so on:

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge): A Clash GUI based on tauri. Supports Windows, macOS and Linux.
- [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev): The upstream this project is derived from (GPL-3.0).
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri): Build smaller, faster, and more secure desktop applications with a web frontend.
- [Dreamacro/clash](https://github.com/Dreamacro/clash): A rule-based tunnel in Go.
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): A rule-based tunnel in Go.
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg): A Windows/macOS GUI based on Clash.
- [vitejs/vite](https://github.com/vitejs/vite): Next generation frontend tooling. It's fast!

## Privacy

本应用不收集任何用户数据，配置与日志仅保存在本地。详见[隐私政策](./PRIVACY.md)。

This application does not collect any user data; configuration and logs stay on
your own device. See the [Privacy Policy](./PRIVACY.md) for details.

## License

GPL-3.0 License. See [License here](./LICENSE) for details.
