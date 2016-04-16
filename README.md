# AWS IoT with Node.js and Python
Node.js and Python scripts for AWS IoT, used in Temasek Polytechnic Smart IoT Applications course. See also:

- https://github.com/lupyuen/RaspberryPiImage
- https://www.facebook.com/photo.php?fbid=10203864039081512&set=a.1222080012259.25950.1836747147&type=3&theater

Getting started:

0. Go to AWS IoT Console, create a Thing named "g0_temperature_sensor".  (Will be renamed to "g88_temperature_sensor".)

0. Add an attribute "temperature" and set the value to 28 (number, not string).

0. Under the newly-created Thing, click "Connect a Device".  Download the *.private.pem.key and *.certificate.pem.crt files, copy to the root folder of the project.

0. Create a rule named "g88_too_hot".  Use this query: SELECT * FROM '$aws/things/+/shadow/update/accepted' WHERE state.reported.temperature > 25

0. Select "SNS" as the action. Create a new topic and subscribe to it.

0. Run this script. It should trigger an SNS email alert.

Preparing the SD Card for Raspberry Pi 2 and 3:

0. Full version of Raspbian Jessie: https://www.raspberrypi.org/downloads/raspbian/

0. Full version of Noobs: https://www.raspberrypi.org/downloads/noobs/

0. Burn the image to SD card: https://www.raspberrypi.org/documentation/installation/installing-images/README.md

0. Get the Raspberry Pi console cable: https://learn.adafruit.com/adafruits-raspberry-pi-lesson-5-using-a-console-cable?view=all

0. Connect as follows: Edge with SDCard / Empty / Empty / Black / White / Green
Gnd / Tx / Rx
Do not connect Red because we are using external power

0. Install the driver from http://www.prolific.com.tw/US/ShowProduct.aspx?p_id=229&pcid=41

0. Attach the GrovePi+ Shield and sensors: http://www.seeedstudio.com/depot/GrovePi-Starter-Kit-for-Raspberry-Pi-ABB23-CE-certified-p-2572.html?cPath=122_154_151

0. Connect a USB keyboard, mouse and HDMI monitor. Boot and connect to wifi. 

0. Click Menu -> Preferences -> Raspberry Pi Configuration.  Click Interfaces. Enable SSH, SPI, I2C and Serial.  Reboot.

0. Download the GrovePi+ software:
sudo git clone https://github.com/DexterInd/GrovePi.git

0. Run GrovePi/Script/grovepi_python3_install.sh after setting execute access right on the file. Reboot.  (Note: Don't use install.sh because it caused my Raspberry Pi 3 to boot with a black screen.)

0. Connect the Grove buzzer to port D8.  Test by running:
cd ~/GrovePi/Software/Python
python3 grove_buzzer.py 

0. Check that Python supports TLS.  Otherwise MQTT requests to AWS IoT will fail.
python3
import ssl
ssl.OPENSSL_VERSION
Ensure that version >=1.0.1

0. Set the system default to python3.4 instead of python2.x.  Python 2.x does not support TLS.
sudo rm /usr/bin/python
sudo ln -s /usr/bin/python3.4 /usr/bin/python

0. Install paho, the MQTT library for Python
pip3 install paho



