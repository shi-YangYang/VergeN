# Acceptance

## Result

PASS。独立验收已完成。

## Spec Coverage

根目录的 Markdown 仅保留 README 和 AGENTS。面板发布、员工下载与 iOS 订阅按功能归位。测试和环境配置的新位置均有调用者。客户端打包与运维服务部署沿用既有入口。

## Validation

风险级别为 S3，变更涉及构建环境、工具路径和 CI。

- 根 Vitest 通过 14 个测试文件、57 个用例；Node 工具测试通过 11 项。独立验收另在仅有根依赖的临时目录执行两份迁移的面板测试，11 项通过。
- 运维面板 TypeScript 检查和 Vite 构建通过，Go 服务构建通过。定向 ESLint、Biome 和 Knip 检查通过。
- 对照迁移前的代码，拆移的 17 个顶层函数保留原函数体。核对了 CI、钩子、发布工具和文档中的路径。
- 本机打包配置移动后权限为 0600，Git 按忽略规则排除该文件。
- 三个 GitHub Actions 工作流通过 actionlint 和 ShellCheck。在两份干净副本中，根前端 CI、桌面 Web 构建、草稿发布脚本的 8 个用例，以及运维面板构建和 Go build、vet、test 均通过。
- 使用 Release 命令生成的 Linux amd64 二进制可从部署步骤预期的路径取出。在隔离容器启动后，健康检查、运维首页和该页引用的 JavaScript 均可访问。
- Release 分支检查接受 `main`，拒绝 `dev` 和 tag。复用已有 ARM64 APK 及其 Gradle 元数据验证产物收集，目标文件位于草稿上传路径且 SHA-256 一致。

## Issues

规格及模板在审查后补齐了当前行为、目标行为和兼容性章节。

## Regression Risks

旧工作副本的自定义 Vite 环境文件须迁移到新目录。原生客户端完整打包、远端 CI 和生产部署未执行。

## Required Rework

无。
