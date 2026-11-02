# 参与贡献

欢迎反馈兼容问题、改善浏览器调度、提交可重复的性能和画质对照。请先阅读 README、docs/LICENSING.md 与 THIRD_PARTY_NOTICES.md。

## 开发

使用 Node.js 24 与 pnpm 11，执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm package`、`pnpm release:verify`。将 dist 作为解压扩展加载。不要提交 node_modules、浏览记录、视频内容、账号数据、访问令牌或本地诊断中的私人信息。

## 贡献要求

说明复现步骤、版本、硬件和预期/实际行为。对运行时或算法改动，提供相关测试与真实播放对照；对性能结论明确是模型耗时、整链耗时还是实际呈现帧率。不要把合成测试包装成线上实测。

保留上游来源和许可证；不要直接为第三方组件附加禁止商用条款。贡献者应有权提交代码，并接受相应文件的许可证。包含 Framegen 受限权重的分发仍须遵守其原有条款。
