<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="VergeN" width="128" />
  <br>
  VergeN — 客户端与自托管运维面板
  <br>
</h1>

VergeN 是基于 [clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)(GPL-3.0)二次开发的 VPN 客户端:桌面端基于 [Tauri 2](https://github.com/tauri-apps/tauri) 与 Rust,内核为 [mihomo(Clash Meta)](https://github.com/MetaCubeX/mihomo);配套一个用 Go 写的运维面板,负责账号、订阅、公告与版本分发。

## 客户端特性

- 内置 mihomo 内核,支持切换 `Alpha` 版本内核
- 简洁美观的用户界面,支持自定义主题颜色、代理组/托盘图标以及 `CSS Injection`
- 配置文件管理和增强(Merge 和 Script),配置文件语法提示
- 系统代理和守卫、`TUN(虚拟网卡)` 模式
- 可视化节点和规则编辑
- WebDav 配置备份和同步
- 钉钉扫码登录,账号由组织统一管理
- 订阅等敏感配置 AES-256-GCM 加密落盘
- 自动更新:从自建更新服务拉取安装包并校验签名后静默安装

## 运维面板特性

部署在服务器上(单二进制,面板内嵌为静态资源),浏览器访问 `/admin`:

- 员工账号管理:创建、停用、重置密码、绑定钉钉 UnionID
- 订阅管理:增删改、启停;客户端通过心跳拉取
- 公告管理:逐用户认领、可撤回
- 策略管控:锁定端口/外部控制器等敏感设置
- 版本发布:多版本管理(Windows / macOS / Linux),客户端弹窗提示与一键更新
- 公开下载页与登录/下载中转页
- 健康检查 `/healthz`,在线人数与版本分布看板

## 仓库结构

- `src/` — 客户端前端(React)
- `src-tauri/` — Tauri 客户端(Rust)
- `server/` — 运维服务(Go)与面板前端(`server/web`,React,构建产物内嵌)
- `crates/` — 客户端附属 Rust 组件(内核管理、国际化等)

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
