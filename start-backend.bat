@echo off
echo ========================================
echo   VoiceSong Backend Starter
echo ========================================
echo.

cd Vsonice-backend

echo Checking for virtual environment...
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    echo.
)

echo Activating virtual environment...
call venv\Scripts\activate.bat
echo.

echo Checking for .env file...
if not exist ".env" (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo.
)

echo Installing/Updating dependencies...
pip install -r requirements.txt
echo.

echo ========================================
echo   Starting Backend Server...
echo   API will be available at:
echo   http://localhost:8000
echo   
echo   API Docs: http://localhost:8000/docs
echo ========================================
echo.

python main.py
