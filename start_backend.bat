@echo off
title UPI FraudGuard AI - Backend Server
echo ==========================================================
echo               UPI FRAUDGUARD AI BACKEND
echo ==========================================================
echo.
echo [1/2] Activating Python virtual environment...
if not exist venv\Scripts\activate.bat (
    echo [Error] Virtual environment 'venv' not found. Please wait for dependencies to finish installing.
    pause
    exit /b
)
call venv\Scripts\activate.bat

echo [2/2] Running FastAPI application server on http://localhost:8000...
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload

pause
