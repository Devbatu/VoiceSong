# VoiceSong - AI Paket Yükleme Script'i
# Bu script büyük AI paketlerini arka planda yükler

Write-Host "================================" -ForegroundColor Cyan
Write-Host "VoiceSong AI Packages Installer" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Virtual environment'ı aktifleştir
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& ".\venv\Scripts\Activate.ps1"

# PyTorch ve AI kütüphanelerini yükle
Write-Host ""
Write-Host "Installing PyTorch (CPU version) and AI libraries..." -ForegroundColor Yellow
Write-Host "This may take 10-20 minutes depending on your internet speed." -ForegroundColor Gray
Write-Host ""

python -m pip install -r requirements-ai.txt --timeout 600

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ AI packages installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now use AudioCraft and Demucs features." -ForegroundColor Green
    Write-Host "Run 'python main.py' to start the server." -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "✗ Installation failed. Please check your internet connection." -ForegroundColor Red
    Write-Host "You can retry by running this script again." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
