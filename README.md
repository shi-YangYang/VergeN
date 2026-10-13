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

在 GitHub Actions 中手动运行 Release 工作流,选择 `main` 分支并在 tag 输入框填写 `vX.Y.Z` 格式的客户端版本号。推送 tag 不会触发发布,工作流也不创建或上传 GitHub Release。构建产物通过 Actions artifacts 传给部署任务(见 [release.yml](.github/workflows/release.yml)):

- 桌面三平台(macOS arm64 / Windows x64 / Linux x64),包内版本与本次输入一致
- Android 仅构建 arm64-v8a,命名 `vergen-<版本号>-android-arm64-v8a.apk`
- 运维服务仅构建 Linux amd64,产物为 `vergen-server-linux-amd64`

配置 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY` secrets 后,CD 自动安装并重启运维服务(内嵌新面板),再将各平台安装包部署到 `/var/lib/vergen/downloads`。公开下载页 `/download` 自动列出这些安装包,显示平台、版本/架构文件名和大小,无需手动登记下载链接;已有安装包与后台手动发布记录会保留。客户端自动更新仍使用后台配置的 updater manifest。

部署目标为 Linux amd64 服务器,部署账号需要免密 sudo。可选 secrets: `DEPLOY_SSH_PORT`(默认 22)、`DEPLOY_PORT`(服务监听本机端口,默认 8080)。服务通过已有 Caddy 配置对外提供访问。

其他仓库配置:变量 `VITE_ENTERPRISE_SERVER_URL`(烧进桌面客户端的公司服务地址);secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`(桌面更新签名)、`ANDROID_KEYSTORE_BASE64` 与 `ANDROID_SIGN_STORE_PASSWORD / ANDROID_SIGN_KEY_PASSWORD`(Android 生产签名,未提供 keystore 时使用 debug 签名)。

本地 Android 构建如需覆盖默认服务地址,编辑 `android/app/src/main/java/com/github/kr328/clash/enterprise/EnterpriseKit.kt` 顶部的 `VERGEN_SERVER_URL`。

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
