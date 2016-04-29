#!/usr/bin/env bash

# This script looks for SSID config files written by set_wifi_password and updates the wifi config.
# The files are located in /boot and /dev/mmcblk0p1.

cd /home/pi/WiFi
shopt -s nullglob
FILES=/boot/pending_wifi_config_*
for f in $FILES
do
  echo "Processing $f..."
  python3 update_wifi_config.py $f
done

mkdir /tmp/recovery
mount /dev/mmcblk0p1 /tmp/recovery/
FILES=/tmp/recovery/pending_wifi_config_*
for f in $FILES
do
  echo "Processing $f..."
  python3 update_wifi_config.py $f
done
umount /tmp/recovery/
