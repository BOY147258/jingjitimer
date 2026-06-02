@echo off
echo ========================================
echo 竞迹计时系统 - 防火墙配置
echo ========================================
echo.
echo 正在添加防火墙规则，允许 8080 端口...
echo.

netsh advfirewall firewall add rule name="竞迹计时-8080-TCP" dir=in action=allow protocol=TCP localport=8080

if %errorlevel% equ 0 (
    echo.
    echo ✅ 防火墙规则添加成功！
    echo.
    echo 现在手机可以访问了：
    echo http://192.168.1.199:8080/simple.html
    echo.
) else (
    echo.
    echo ❌ 添加失败，请右键点击此文件，选择"以管理员身份运行"
    echo.
)

pause
