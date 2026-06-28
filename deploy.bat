@echo off
chcp 65001 > nul
set "GIT_PATH=C:\Program Files\Git\cmd\git.exe"

REM 檢查是否已設定 GitHub 遠端網址
"%GIT_PATH%" remote get-url origin >nul 2>&1
if %errorlevel% equ 0 goto PUSH

echo =============================================
echo  這是您第一次推送，請輸入您的 GitHub 儲存庫網址
echo  例如: https://github.com/您的帳號名/house-db.git
echo =============================================
set /p REPO_URL="請貼上網址並按 Enter: "
if "%REPO_URL%"=="" (
    echo 取消操作。
    pause
    exit /b
)
"%GIT_PATH%" remote add origin %REPO_URL%
"%GIT_PATH%" branch -M main
echo 成功連結遠端 GitHub 儲存庫。

:PUSH
echo.
echo 正在偵測變更並打包上傳至 GitHub...
"%GIT_PATH%" add .
"%GIT_PATH%" commit -m "Auto update: %date% %time%" >nul 2>&1
"%GIT_PATH%" push -u origin main

if %errorlevel% equ 0 (
    echo =============================================
    echo  🎉 檔案上傳成功！
    echo =============================================
) else (
    echo.
    echo ⚠️ 上傳失敗。如果是第一次上傳，請確保您已登入彈出的 GitHub 驗證視窗。
)
pause
