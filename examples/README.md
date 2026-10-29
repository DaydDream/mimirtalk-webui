# 简单检查示例

本目录只保留两个小型示例，不依赖完整测试框架，不写入用户项目，也不生成截图。

- `node examples/check_export_groups.cjs`：调用实际消息分组函数，检查20/21/40/41条等边界。
- 先启动WebUI，再执行 `python examples/check_health.py http://127.0.0.1:8765`：检查服务健康接口。
