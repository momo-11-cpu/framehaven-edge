# 帧境 Framehaven 1.0.0

面向 Microsoft Edge 的本地 SDR 视频增强扩展。适合 1080p、约 4 Mbps 的普通 HTML5 视频，提供 2× / 4× Framegen AI 补帧、压缩修复、降噪、去色带、锐化与 2× AI 放大。

下载 `framehaven-edge-1.0.0.zip`，解压到固定目录，在 Edge 扩展管理页开启开发人员模式，加载包含 manifest.json 的目录。更新原目录后重新加载扩展并刷新播放页。SHA-256 见同名 .sha256 文件。无需本机辅助程序、Python 或 WebNN。

实测参考平台：Windows 11 23H2、Edge 156.0.4314.58、Intel Core i5-14600KF、RTX 4060 Ti 8 GB、32 GB 内存。其他设备按 README 兼容矩阵核对，完整功能需要 WebGPU shader-f16。

源代码开放；包含 Framegen 预训练权重的完整安装包仅限个人及非商业研究使用。代码遵守其 GPL/LGPL/MIT 许可；不能给 GPL 代码追加禁止商用限制。详见 docs/LICENSING.md。
