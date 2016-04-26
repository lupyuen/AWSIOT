#!/bin/bash

cd /home/pi/TP-IoT
curl https://raw.githubusercontent.com/lupyuen/RaspberryPiImage/master/home/pi/TP-IoT/read_dht22.py >read_dht22.py
python read_dht22.py

