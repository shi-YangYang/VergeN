# 手机 Web 验收

## Result

PASS。独立审阅覆盖了导航、地址权限、版本选择和表单状态。

## Spec Coverage

运维七个页面及退出入口均可到达。员工下载页可切换版本、展开电脑下载、打开 iOS 对话框。发布区切换前后保留已输入的版本号。

## Validation

S2。Chrome 使用虚构账号、订阅和版本数据，在 320px、390px 和 1280px 下操作。390px 下原地址表的滚动宽度为 794px，可见宽度 322px。新版地址列表在当前屏宽展示查询结果与操作。桌面保留原表格。运维前端 TypeScript 和 Vite 构建通过。

## Issues

未发现阻碍上述操作的问题。

## Regression Risks

窄屏测试模拟了 Android 钉钉的浏览器标识。真机 WebView、系统键盘和系统剪贴板体验尚待实际设备验证。

## Required Rework

无。
