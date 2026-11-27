# 独立验收

## Result
PASS（最终复验；首轮为 FAIL）

## Spec Coverage
桌面和 Android 按服务保存明确的布尔值；探测失败保留缓存，成功早停，单轮最多五次。扫码错误留在扫码区域，密码入口仍可操作。缓存只影响入口，不用于认证。桌面收到明确关闭后返回密码标签；复查恢复启用只恢复入口，再次选择钉钉才会发起新的授权。

## Validation
- S2（跨端登录入口与错误契约）；本机实例唤醒为 S1。审阅实现、Vitest 2/2、桌面类型和 Rust 检查、Android JDK 21 编译和 8 例模拟传输结果，以及本机 IPC 对照记录。
- 首轮 FAIL：Chromium 夹具加载实际 React 登录组件，模拟 Tauri 命令并计数。先保存启用值，刷新并挂起本轮能力查询；点击「钉钉登录」一次，再让查询返回 `false`；将响应改为 `true` 后，**只点「重新检查钉钉登录状态」**。预期授权请求保持 1 次，实际为 2 次，退出码 1：

  ```text
  after background disabled, qr requests=1, tab selected=true
  after availability recheck only, qr requests=2 (expected 1); extraAuthStart=1
  ```
- 最终复验：核对返工差异，只有明确的 `false` 会清除扫码选择；`true` 或未取得明确结果均不会切换标签。审阅同一情境的 Chromium 记录，退出码 0：

  ```text
  after background disabled, qr requests=1, tab selected=false
  after availability recheck only, qr requests=1 (expected 1); extraAuthStart=0
  after employee selects DingTalk again, qr requests=2 (expected 2)
  ```
- 另一个 Chromium 场景记录了缓存启用 / 关闭、离线五次后停止、恢复焦点或网络未增加请求、扫码错误未弹全局提示及密码入口仍可操作。本机 IPC 的 macOS 代理夹具在代理不可用时，唤醒成功次数从 0 变为 1，回滚后为 0。

## Issues
首轮发现的残留标签选择已消除；未发现需要继续返工的问题。

## Regression Risks
Chromium 记录验证授权命令次数，不代表真机 OAuth 登录成功。Android 的证据是编译、模拟传输和代码审阅。Windows 原弹窗缺标题和首行日志；本机代理夹具只验证了实例唤醒，未确认是该弹窗的原因。

## Required Rework
无。
