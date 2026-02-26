@echo off
echo ========================================
echo   VoiceSong Frontend Starter
echo ========================================
echo.

cd Vsonice-frontend

echo Installing/Updating dependencies...
call npm install
echo.

echo ========================================
echo   Starting Frontend Server...
echo   App will be available at:
echo   http://localhost:5173
echo ========================================
echo.

call npm run dev
