# AWS IoT with Node.js and Python
Node.js and Python scripts for AWS IoT, used in Temasek Polytechnic Smart IoT Applications course. See also:

- https://github.com/lupyuen/RaspberryPiImage
- https://www.facebook.com/photo.php?fbid=10203864039081512&set=a.1222080012259.25950.1836747147&type=3&theater

## Getting started:

0. Go to AWS IoT Console, create a Thing named "g0_temperature_sensor".  (Will be renamed to "g88_temperature_sensor".)

0. Add an attribute "temperature" and set the value to 28 (number, not string).

0. Under the newly-created Thing, click "Connect a Device".  Download the *.private.pem.key and *.certificate.pem.crt files, copy to the root folder of the project.

0. Create a rule named "g88_too_hot".  Use this query: SELECT * FROM '$aws/things/+/shadow/update/accepted' WHERE state.reported.temperature > 25

0. Select "SNS" as the action. Create a new topic and subscribe to it.

0. Run this script. It should trigger an SNS email alert.

## Preparing the SD Card for Raspberry Pi 2 and 3:

0. Download full version of Raspbian Jessie: https://www.raspberrypi.org/downloads/raspbian/

0. Download full version of Noobs: https://www.raspberrypi.org/downloads/noobs/

0. Burn the Rasbian image to SD card: https://www.raspberrypi.org/documentation/installation/installing-images/README.md

0. Get the Raspberry Pi console cable: https://learn.adafruit.com/adafruits-raspberry-pi-lesson-5-using-a-console-cable?view=all

0. Connect as follows: 
   
   | Edge with SDCard | Empty | Empty | Black | White | Green |
   | --- | --- | --- | --- | --- | --- |
   | |  |  |  (Gnd) |  (Tx) |  (Rx) |


   Do not connect Red cable because we are using external power

0. Install the console cable driver from http://www.prolific.com.tw/US/ShowProduct.aspx?p_id=229&pcid=41

0. Attach the GrovePi+ Shield and sensors: http://www.seeedstudio.com/depot/GrovePi-Starter-Kit-for-Raspberry-Pi-ABB23-CE-certified-p-2572.html?cPath=122_154_151

0. Connect a USB keyboard, mouse and HDMI monitor. Boot and connect to wifi. 

0. Click Menu -> Preferences -> Raspberry Pi Configuration.  Click Interfaces. Enable SSH, SPI, I2C and Serial.  Reboot.

0. Download the GrovePi+ software:
   ```
sudo git clone https://github.com/DexterInd/GrovePi.git
   ```

0. Run GrovePi/Script/grovepi_python3_install.sh after setting execute access right on the file. Reboot.  (Note: Don't use install.sh because it caused my Raspberry Pi 3 to boot with a black screen.)

0. Connect the Grove buzzer to port D8.  Test by running:
   ```
cd ~/GrovePi/Software/Python
python3 grove_buzzer.py 
   ```

0. Check that Python supports TLS.  Otherwise MQTT requests to AWS IoT will fail.
   ```
python3
import ssl
ssl.OPENSSL_VERSION
   ```
   Ensure that OpenSSL version >=1.0.1

0. Set the system default to python3.4 instead of python2.x.  Python 2.x does not support TLS.
   ```
vi ~/.bash_aliases
Change to
# Some more alias to avoid making mistakes:
alias rm='rm -i'
alias cp='cp -i'
alias mv='mv -i'

# For TP IoT: Alias python to python3 because python2 doesn't support TLS needed for AWS IoT.
alias python=python3
   ```

0. Install paho, the MQTT library for Python
   ```
sudo pip3 install paho-mqtt
   ```

0. Remove unnecessary packages so we can clone the NOOBS image easily:
   ```
rm -rf ~/Documents/*
rm -rf ~/python_games/
rm -rf ~/GrovePi/Firmware
rm -rf ~/GrovePi/Hardware
rm -rf ~/GrovePi/Software/CSharp
rm -rf ~/GrovePi/Software/Scratch
sudo apt-get purge wolfram-engine
sudo apt-get purge sonic-pi
sudo apt-get purge scratch
sudo apt-get purge nuscratch
sudo apt-get autoremove
   ```

0. Update the installed packages:
   ```
sudo apt-get update
sudo apt-get upgrade
sudo reboot now
   ```

0. Install common tools
   ```
sudo apt-get install telnet
sudo apt-get install npm
sudo npm config -g set python /usr/bin/python2.7

   ```

0. Install latest Node.js from https://nodejs.org/en/download/stable/ (ARMv7)
   ```
wget https://nodejs.org/dist/v5.10.1/node-v5.10.1-linux-armv7l.tar.xz
tar -xvf node-v5.10.1-linux-armv7l.tar.xz
sudo cp -r node-v5.10.1-linux-armv7l /opt
sudo mv /usr/bin/nodejs /usr/bin/nodejs.v0.10.29
sudo rm /usr/bin/node
sudo ln -s /opt/node-v5.10.1-linux-armv7l/bin/node /usr/bin/node
sudo ln -s /opt/node-v5.10.1-linux-armv7l/bin/node /usr/bin/nodejs
sudo ln -s /opt/node-v5.10.1-linux-armv7l/lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm
   ```

0. Install Ajenti: http://support.ajenti.org/topics/1116-installing-on-debian/
   ```
sudo bash
wget -O- https://raw.github.com/ajenti/ajenti/1.x/scripts/install-debian.sh | sh
exit
sudo service ajenti restart
   ``` 

0. Browse to
http://raspberrypi:8000/.
Login in as root, password admin

0. Add text widget for tty.js web terminal:
   ```
   <b>Welcome to the Ajenti Web Console</b><br>
   For monitoring and controlling your Raspberry Pi<br>
   <a target='_blank' href='http://raspberrypi:3000'><span class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i class="fa fa-terminal fa-stack-1x fa-inverse"></i></span></a>
   <a target='_blank' href='http://raspberrypi:3000'>Open Raspberry Pi Web Terminal</a>
   ```

0. Add text widget for AWS:
   ```
   
   <b>Amazon Web Services and Common Links</b><br>
   
   <a target='_blank' href='https://tp-iot.signin.aws.amazon.com/console'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-unlock-alt fa-stack-1x fa-inverse"
      title="Login to AWS"></i></span></a>
   <a target='_blank' 
   href='https://tp-iot.signin.aws.amazon.com/console'
   ><b>Login to Amazon Web Services</b></a> <br>
   
   <a target='_blank' href='https://us-west-2.console.aws.amazon.com/iot/home?region=us-west-2#/dashboard'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-cube fa-stack-1x fa-inverse"
      title="AWS IoT"></i></span></a>
   <a target='_blank' 
   href='https://us-west-2.console.aws.amazon.com/iot/home?region=us-west-2#/dashboard'
   ><b>AWS IoT</b> for controlling your IoT devices</a><br>
   
   <a target='_blank' href='https://us-west-2.console.aws.amazon.com/sns/v2/home?region=us-west-2#/topics'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-envelope fa-stack-1x fa-inverse"
      title="Simple Notification Service"></i></span></a>
   <a target='_blank' 
   href='https://us-west-2.console.aws.amazon.com/sns/v2/home?region=us-west-2#/topics'
   ><b>Simple Notification Service</b> for email alerts</a><br>
   
   <a target='_blank' href='https://us-west-2.console.aws.amazon.com/dynamodb/home?region=us-west-2#tables:'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-list-alt fa-stack-1x fa-inverse"
      title="DynamoDB"></i></span></a>
   <a target='_blank' 
   href='https://us-west-2.console.aws.amazon.com/dynamodb/home?region=us-west-2#tables:'
   ><b>DynamoDB database</b> for storing sensor data</a><br>
   
   <a target='_blank' href='https://us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-cogs fa-stack-1x fa-inverse"
      title="Lambda"></i></span></a>
   <a target='_blank' 
   href='https://us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions'
   ><b>Lambda</b> for executing your programs in the cloud</a><br>
   
   <a target='_blank' href='https://service.sumologic.com/ui/'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-bar-chart fa-stack-1x fa-inverse"
      title="Sumo Logic"></i></span></a>
   <a target='_blank' 
   href='https://service.sumologic.com/ui/'
   ><b>Sumo Logic</b> for IoT monitoring and dashboards</a><br>
   
   <a target='_blank' href='https://tp-iot.slack.com/'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-users fa-stack-1x fa-inverse"
      title="Slack"></i></span></a>
   <a target='_blank' 
   href='https://tp-iot.slack.com/'><b>Slack</b> 
   for realtime collaboration</a><br>
   
   <a target='_blank' href='http://bit.ly/tp-iot'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-life-ring fa-stack-1x fa-inverse"
      title="FAQ"></i></span></a>
   <a target='_blank' 
   href='http://bit.ly/tp-iot'
   ><b>Frequently Asked Questions</b></a><br>


   ```

0. TODO: Update /etc/ajenti/config.json, replace "raspberrypi" by hostname

0. Install tty.js web terminal: https://github.com/chjj/tty.js/
   ```
cd /tmp
npm install tty.js
sudo mkdir /opt/tty.js
sudo cp -r node_modules /opt/tty.js
cd /opt/tty.js
sudo node node_modules/tty.js/bin/tty.js --daemonize
   ```

0. TODO: Pass token from Ajenti to tty.js

0. Copy /home/pi/TP-IoT from 
https://github.com/lupyuen/RaspberryPiImage to /home/pi/TP-IoT on the Raspberry Pi

0. Run the sample script to send data to AWS IoT MQTT 
   ```
cd /home/pi/TP-IoT
python send_sensor_data.py
   ```
   You should see ???

0. TODO: Encrypt wifi password

0. TODO: Setup AWS menubar

0. TODO: Sumo Logic 

0. TODO: Hoiio

0. TODO: Web Terminal vs SSH Command Line

0. TODO: AWS IoT Certs

0. TODO: Sumo Logic vs Elasticsearch/Kibana





