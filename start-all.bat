@echo off
echo ========================================
echo   VoiceSong - Full Stack Starter
echo ========================================
echo.
echo This will start both backend and frontend servers.
echo.
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Press any key to continue...
pause > nul

start cmd /k "title VoiceSong Backend && cd Vsonice-backend && python -m venv venv && call venv\Scripts\activate.bat && pip install -r requirements.txt && python main.py"

timeout /t 3 > nul

start cmd /k "title VoiceSong Frontend && cd Vsonice-frontend && npm install && npm run dev"

echo.
echo ========================================
echo   Both servers are starting...
echo   Check the new terminal windows
echo ========================================
