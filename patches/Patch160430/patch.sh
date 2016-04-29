#!/bin/bash

echo Patching...
shopt -s nullglob

SOURCE=boot
DESTFOLDERS=/media/user/${SOURCE}*
for DEST in $DESTFOLDERS
do
	echo Copying ${SOURCE}/* to ${DEST}...
	cp -r ${SOURCE}/* ${DEST}
	chmod a+x ${DEST}/*.sh
	chmod a+x ${DEST}/*.py
	chmod a+x ${DEST}/*.exe
	chmod a+x ${DEST}/set_*
done

SOURCE=RECOVERY
DESTFOLDERS=/media/user/${SOURCE}*
for DEST in $DESTFOLDERS
do
	echo Copying ${SOURCE}/* to ${DEST}...
	cp -r ${SOURCE}/* ${DEST}
	chmod a+x ${DEST}/*.sh
	chmod a+x ${DEST}/*.py
	chmod a+x ${DEST}/*.exe
	chmod a+x ${DEST}/set_*
done

SOURCE=root
DESTFOLDERS=/media/user/${SOURCE}*
for DEST in $DESTFOLDERS
do
	echo Copying ${SOURCE}/* to ${DEST}...
	cp -r ${SOURCE}/* ${DEST}
  chmod a+x ${DEST}/home/pi/WiFi/*.sh
  chmod a+x ${DEST}/home/pi/WiFi/*.py
done

echo Patching completed

