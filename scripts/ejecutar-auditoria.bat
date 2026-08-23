@echo off
:: Auto-elevate to admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Solicitando permisos de administrador...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
:: Run the audit
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0auditoria.ps1"
echo.
echo Presiona cualquier tecla para cerrar...
pause >nul
