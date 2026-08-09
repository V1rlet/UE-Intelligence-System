@echo off
:: 旧安装入口保留为薄兼容适配层。
:: 新的版本化发布、候选端口验收和失败回滚统一由 tools/service-deploy.ts 持有。

net session >nul 2>&1 || (echo 需要管理员权限，请右键"以管理员身份运行" & pause & exit /b 1)

cd /d "%~dp0"
call npm run service:prepare || (echo 候选构建或验收失败，现有服务未变更 & pause & exit /b 1)
call npm run service:activate || (echo 服务激活失败；工具已尝试恢复上一版本 & pause & exit /b 1)

echo.
echo 服务 graph-brain-viewer 已通过版本化发布流程启动（localhost:3030）
echo 回滚：npm run service:rollback
pause
