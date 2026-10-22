#!/usr/bin/env bash
# Roda dentro do emulador Android do GitHub. Instala o app, executa o autoteste e guarda prints e registros.
set -x
OUT=resultado-teste
mkdir -p "$OUT"
PKG=com.pedroparis.vitrine

adb shell dumpsys package com.google.android.webview | grep -m1 versionName > "$OUT/webview.txt" || true
adb shell getprop ro.build.version.release >> "$OUT/webview.txt" || true
adb install -r Vitrine.apk > "$OUT/instalar.txt" 2>&1
adb logcat -c

# 1) Autoteste: ponte, catálogo, Riot, demonstração e página de login da Riot
adb shell am start -n $PKG/.MainActivity --ez autotest true
sleep 20; adb exec-out screencap -p > "$OUT/1-inicio.png"
sleep 25; adb exec-out screencap -p > "$OUT/2-demonstracao.png"
sleep 30; adb exec-out screencap -p > "$OUT/3-login-riot.png"
adb logcat -d -s Vitrine:* AndroidRuntime:E > "$OUT/log-autoteste.txt"

# 2) Abrir normal duas vezes seguidas (o problema relatado: "abri uma vez, depois fica carregando")
adb shell am force-stop $PKG
adb logcat -c
adb shell am start -n $PKG/.MainActivity
sleep 15; adb exec-out screencap -p > "$OUT/4-abrir-normal.png"
adb shell am force-stop $PKG
adb shell am start -n $PKG/.MainActivity
sleep 15; adb exec-out screencap -p > "$OUT/5-abrir-de-novo.png"
adb logcat -d -s Vitrine:* AndroidRuntime:E > "$OUT/log-reabrir.txt"

# 3) Sem internet: o app tem que mostrar um aviso, não girar pra sempre
adb shell am force-stop $PKG
adb shell svc wifi disable; adb shell svc data disable
adb logcat -c
adb shell am start -n $PKG/.MainActivity
sleep 5; adb shell input keyevent KEYCODE_BACK; true
adb shell am start -n $PKG/.MainActivity --ez autotest true
sleep 40; adb exec-out screencap -p > "$OUT/6-sem-internet.png"
adb logcat -d -s Vitrine:* AndroidRuntime:E > "$OUT/log-sem-internet.txt"
adb shell svc wifi enable; adb shell svc data enable

ls -la "$OUT"
exit 0
