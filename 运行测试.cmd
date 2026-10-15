@echo off
rem 运行全部自测（需要 Node.js）
setlocal
cd /d "%~dp0"
echo ==== 规则引擎测试 ====
node tests\rules.test.js || goto :fail
echo.
echo ==== 牌局引擎测试 ====
node tests\game.test.js || goto :fail
echo.
echo ==== 界面联调测试 ====
node tests\ui.test.js || goto :fail
echo.
echo 全部测试通过。
exit /b 0
:fail
echo.
echo 测试未通过。
exit /b 1
