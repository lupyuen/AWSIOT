: Before running this script:
: start C:\Users\guppy\Downloads\pip-Win_1.7.exe

: Set interpreter to 32-bit Python:
: C:\Users\guppy\AppData\Local\Programs\Python\Python35-32\python.exe

: In the Command field enter:
: venv pyi35

cd \python\pyi35\work
del dist\set_wifi_password_from_pi.exe
del dist\set_wifi_password_from_windows.exe
del dist\set_wifi_password_from_pi.py
del dist\pending*
copy /y C:\IoT\RaspberryPiImage\boot\set_wifi_password_from_pi.py .

::  win-private-assemblies is needed to prevent missing DLLs that may prevent this program from running on some PCs.
pyinstaller --onefile --win-private-assemblies set_wifi_password_from_pi.py
move dist\set_wifi_password_from_pi.exe dist\set_wifi_password_from_windows.exe
copy set_wifi_password_from_pi.py dist

copy /y dist\set_wifi_password_from_windows.exe C:\IoT\RaspberryPiImage\boot\
explorer dist
explorer d:\
