@echo off
chcp 65001 >nul
echo ========================================
echo   竞迹计时器 - 一键部署到 GitHub Pages
echo ========================================
echo.

:: 检查 gh CLI
where gh >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 GitHub CLI
    echo 请先安装: https://cli.github.com/
    echo 或运行: winget install GitHub.cli
    pause
    exit /b 1
)

:: 触发部署工作流
echo [1/2] 正在触发部署工作流...
gh workflow run deploy.yml --repo BOY147258/jingjitimer

if %errorlevel% neq 0 (
    echo [错误] 触发失败
    pause
    exit /b 1
)

echo.
echo [2/2] 等待部署完成...
echo 请访问以下链接查看状态:
echo https://github.com/BOY147258/jingjitimer/actions
echo.
echo 部署完成后，访问:
echo https://boy147258.github.io/jingjitimer/
echo.
echo 预计 1-2 分钟后可访问
pause
