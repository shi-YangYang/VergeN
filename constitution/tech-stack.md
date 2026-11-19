# 技术栈与工程入口

| 模块 | 源码 | 验证入口 |
| --- | --- | --- |
| 桌面客户端 | `src/` 是 React 界面，`src-tauri/` 是 Tauri 2 宿主，`crates/` 是 Rust 工作区组件 | 根目录运行 `pnpm typecheck`、`pnpm test`；Rust 使用 `cargo test` |
| Android | `android/` 使用 Kotlin、Gradle、JDK 21；mihomo 是 Gradle 工程内的 Git 子模块 | 在 `android/` 运行 `./gradlew :app:assembleAlphaRelease`，正式包沿用原发布签名 |
| 运维服务 | `server/cmd/server/` 为 Go 入口，`server/internal/` 管理 API、认证、SQLite 和内嵌 Web 资源 | 在 `server/` 运行 `go test ./...`；先构建面板以生成内嵌资源 |
| 运维面板与下载页 | `server/web/` 独立管理 React、TypeScript、MUI 与 Vite 依赖 | `pnpm --dir server/web install --frozen-lockfile`、`pnpm --dir server/web build` |

桌面包依赖由根 `package.json`、`pnpm-lock.yaml`、`Cargo.toml` 和 `Cargo.lock` 管理。Rust 工具链版本取自 `rust-toolchain.toml`，Go 版本取自 `server/go.mod`，两个 pnpm 项目各使用自己的锁文件。

## 配置与测试

- 桌面 Vite 环境文件和本地打包配置在 `config/env/`。首次本地打包时，将 [.env.build.example](../config/env/.env.build.example) 复制为同目录的 `.env.build.local`，再填写本机路径。Android SDK 与签名配置遵循 [Android 构建说明](../android/README.md)。
- 运维面板的版本发布在 `server/web/src/features/releases/`，iOS 订阅管理在 `features/ios/`，员工下载页入口在 `server/web/src/pages/DownloadPage.tsx`。
- 桌面单元测试在对应的 `src/` 模块中；运维网页的版本逻辑及测试在 `server/web/src/features/releases/`。在仓库根用 `pnpm test` 运行 Vitest。
- `tests/tooling/` 放构建与发布工具的 Node 测试，可执行 `node --test tests/tooling/*.test.mjs`。Go 的 `*_test.go` 留在包内；Rust 的集成测试由所属 crate 的 `tests/` 管理。
- 桌面开发和构建脚本见 `scripts/`。代码检查入口为 `pnpm lint`、`pnpm format:check`、`pnpm arch:check`。

## 运维与发布

面板构建输出到 `server/internal/web/dist/`，Go 在编译时内嵌该目录。项目内的本地预览可在 `server/` 运行 `go run ./cmd/server -addr 127.0.0.1:8081 -db vergen.db -downloads downloads`。数据库和已上传文件属于运行数据。

[Release](../.github/workflows/release.yml) 从 main 手动部署服务端。[Client packages (draft)](../.github/workflows/client-packages.yml) 生成各平台的客户端草稿附件。员工可见的版本和说明由管理员在运维面板发布。完整配置见 [README](../README.md)。
