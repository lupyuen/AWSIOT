#!/bin/bash

echo Patching...

SOURCE=boot
DEST=/media/user/boot
echo Copying ${SOURCE}/* to ${DEST}...
cp -r ${SOURCE}/* ${DEST}
chmod ugo+x ${DEST}/*.sh
chmod ugo+x ${DEST}/*.py
chmod ugo+x ${DEST}/*.exe
chmod ugo+x ${DEST}/set_*

SOURCE=RECOVERY
DEST=/media/user/RECOVERY
echo Copying ${SOURCE}/* to ${DEST}...
cp -r ${SOURCE}/* ${DEST}
chmod ugo+x ${DEST}/*.sh
chmod ugo+x ${DEST}/*.py
chmod ugo+x ${DEST}/*.exe
chmod ugo+x ${DEST}/set_*

SOURCE=root
DEST=/media/user/root
echo Copying ${SOURCE}/* to ${DEST}...
cp -r ${SOURCE}/* ${DEST}
chmod ugo+x ${DEST}/home/pi/WiFi/*.sh
chmod ugo+x ${DEST}/home/pi/WiFi/*.py

echo Patching completed

