@echo off
echo ========================================================
echo   OREGUARD / ESP32 - Enabling 2.4GHz Wi-Fi Mode
echo ========================================================
echo.
echo Step 1: Enabling 2.4GHz band on Realtek Wi-Fi Adapter...
powershell -Command "Set-NetAdapterAdvancedProperty -Name 'Wi-Fi' -DisplayName '2.4G Wireless Mode' -DisplayValue 'IEEE 802.11b/g/n/ax'"

echo.
echo Step 2: Waiting 4 seconds for Wi-Fi adapter to refresh...
timeout /t 4 /nobreak >nul

echo.
echo Step 3: Connecting to HelloESP32 Wi-Fi...
netsh wlan connect name="HelloESP32"

echo.
echo Step 4: Checking Connection Status...
timeout /t 3 /nobreak >nul
netsh wlan show interfaces

echo.
echo ========================================================
echo Done! If connected, start your server: npm start / node server.js
echo ========================================================
pause
