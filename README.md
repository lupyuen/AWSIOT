# AWS IoT with Raspberry Pi, Node.js and Python
Raspberry Pi, Node.js and Python scripts for AWS IoT, used in Temasek Polytechnic Smart IoT Applications course. See also:

- https://github.com/lupyuen/RaspberryPiImage
- https://www.facebook.com/photo.php?fbid=10203864039081512&set=a.1222080012259.25950.1836747147&type=3&theater

## Preparing the SD Card for Raspberry Pi 2 and 3:

0. Download full version of Raspbian Jessie: https://www.raspberrypi.org/downloads/raspbian/

0. Download full version of Noobs: https://www.raspberrypi.org/downloads/noobs/

0. Burn the Rasbian image to SD card: https://www.raspberrypi.org/documentation/installation/installing-images/README.md

0. Boot and update the OS
   ```
sudo apt-get update
sudo apt-get upgrade
   ```
When prompted to replace lightdm.conf, respond 'Y'

0. Get the Raspberry Pi console cable: https://learn.adafruit.com/adafruits-raspberry-pi-lesson-5-using-a-console-cable?view=all

0. Connect as follows: 
   
   | Edge with SDCard | Empty | Empty | Black | White | Green |
   | --- | --- | --- | --- | --- | --- |
   | |  |  |  (Gnd) |  (Tx) |  (Rx) |


   Do not connect Red cable because we are using external power

0. Install the console cable driver from http://www.prolific.com.tw/US/ShowProduct.aspx?p_id=229&pcid=41

0. On Pi 3: We must disable Bluetooth else the console cable won't work: https://www.abelectronics.co.uk/kb/article/1035/raspberry-pi-3-serial-port-usage
   ```
sudo nano /boot/config.txt
   ```
   Add at the end of the file
   ```
dtoverlay=pi3-miniuart-bt
   ```
   Exit the editor saving your changes and then:
   ```
sudo reboot
   ```
   Enabling the Serial Console Rasbian Jessie after 18th March 2016 release:
   To enable the serial console, you need to edit the /boot/cmdline.txt file
   ```
sudo nano /boot/cmdline.txt
   ```
   Change the file to the following:
   ```
dwc_otg.lpm_enable=0 console=tty1 console=serial0,115200 root=/dev/mmcblk0p2 rootfstype=ext4 elevator=deadline fsck.repair=yes rootwait
   ```

0. Attach the GrovePi+ Shield and sensors: http://www.seeedstudio.com/depot/GrovePi-Starter-Kit-for-Raspberry-Pi-ABB23-CE-certified-p-2572.html?cPath=122_154_151

0. Connect a USB keyboard, mouse and HDMI monitor. Boot and connect to wifi. 

0. Alternatively, boot with console cable, open a serial port connection from your Mac (or PC):
   ```
   screen /dev/tty.usbserial 115200
   ```
   And connect to wifi manually:
   ```
sudo vi /etc/wpa_supplicant/wpa_supplicant.conf
   ```
   Add:
   ```
network={
    ssid="YOUR_SSID"
    psk="YOUR_PASSWORD"
    key_mgmt=WPA-PSK
}
   ```
   Restart the network:
   ```
   sudo ifdown --exclude=lo -a && sudo ifup --exclude=lo -a
   sudo dhclient -r
   sudo dhclient
   ```

0. Click Menu -> Preferences -> Raspberry Pi Configuration.  Click Interfaces. Enable SSH, SPI, I2C and Serial.  Set time zone to GMT+8.  Set keyboard to US.  Set locale to English US UTF-8 (en_US.UTF-8).  Reboot.

0. Install latest "Latest Features" Node.js from https://nodejs.org/en/download/ (ARMv7)
   ```
wget https://nodejs.org/dist/v6.9.0/node-v6.9.0-linux-armv7l.tar.xz
tar -xvf node-v6.9.0-linux-armv7l.tar.xz
sudo cp -r node-v6.9.0-linux-armv7l /opt
sudo mv /usr/bin/nodejs /usr/bin/nodejs.v0.10.29
sudo rm /usr/bin/node
sudo ln -s /opt/node-v6.9.0-linux-armv7l/bin/node /usr/bin/node
sudo ln -s /opt/node-v6.9.0-linux-armv7l/bin/node /usr/bin/nodejs
sudo ln -s /opt/node-v6.9.0-linux-armv7l/lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm
   ```

0. Download the GrovePi+ software:
   ```
git clone https://github.com/DexterInd/GrovePi.git
   ```

0. Run:
   ```
cd ~/GrovePi/Script
chmod +x grovepi_python3_install.sh
sudo ./grovepi_python3_install.sh
   ```
Reboot.  (Note: Don't use install.sh because it caused my Raspberry Pi 3 to boot with a black screen.)

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

0. Install common tools
   ```
sudo apt-get install telnet
sudo npm config -g set python /usr/bin/python2.7
sudo apt install cmake
sudo apt install zsh
curl -L https://raw.github.com/robbyrussell/oh-my-zsh/master/tools/install.sh | sh

   ```

0. Set the system default to python3.4 instead of python2.x.  Python 2.x does not support TLS.
   ```
nano ~/.bash_aliases
   ```
   Change to
   ```
# Some more alias to avoid making mistakes:
alias rm='rm -i'
alias cp='cp -i'
alias mv='mv -i'

# For TP IoT: Alias python to python3 because python2 doesn't support TLS needed for AWS IoT.
alias python=python3
   ```
Do the same for `nano ~/.zshenv`

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
   ```

0. Copy /home/pi/TP-IoT from 
https://github.com/lupyuen/RaspberryPiImage to /home/pi/TP-IoT on the Raspberry Pi

0. Run the sample script to send data to AWS IoT MQTT 
   ```
cd /home/pi/TP-IoT
python send_sensor_data.py
   ```
   You should see
   ```
pi@raspberrypi:~/TP-IoT $ python send_sensor_data.py
Connecting to AWS IoT...
Log: Received CONNACK (0, 0)
Connected to AWS IoT
Subscribing to MQTT topic $aws/things/g88_pi/shadow/update/accepted
Log: Received SUBACK
Sending sensor data to AWS IoT...
{
    "state": {
        "reported": {
            "sound_level": 320,
            "light_level": 410,
            "temperature": NaN,
            "humidity": 0.0,
            "timestamp": "2016-04-17T14:55:17.812605"
        }
    }
}
Log: Sending PUBLISH (dFalse, q0, r0, m2, '$aws/things/g88_pi/shadow/update', ... (145 bytes)
Sent to AWS IoT
   ```

0. Install pigpio, which is needed by the Python script for reading data from the DHT22 temperature+humidity sensor directly without using resistors: http://abyz.co.uk/rpi/pigpio/examples.html

   Instructions from http://abyz.co.uk/rpi/pigpio/download.html:
   ```
cd /tmp
rm pigpio.zip
sudo rm -rf PIGPIO
wget abyz.co.uk/rpi/pigpio/pigpio.zip
unzip pigpio.zip
cd PIGPIO
make -j4
sudo make install
   ```
   
0. Install GrovePi for Node.js
   ```
   sudo npm install -g node-grovepi
   ```


0. Assign hostname: https://github.com/adafruit/Adafruit-Pi-Finder#adafruit-raspberry-pi-finder
   ```
sudo apt-get install avahi-daemon
sudo apt-get install netatalk
   ```
   Assign local domain e.g. g88pi.local where g88 is the group name: http://www.howtogeek.com/167190/how-and-why-to-assign-the-.local-domain-to-your-raspberry-pi/

0. Change hostname to g88pi where g88 is the group name: http://www.howtogeek.com/167195/how-to-change-your-raspberry-pi-or-other-linux-devices-hostname/
   ```
sudo vi /etc/hosts
sudo vi /etc/hostname
sudo /etc/init.d/hostname.sh
sudo reboot now
   ```
   Change raspberrypi to g88pi where g88 is the group name.
   
0. Share Pi filesystem: http://raspberrywebserver.com/serveradmin/share-your-raspberry-pis-files-and-folders-across-a-network.html
   ```
sudo apt-get install samba samba-common-bin
sudo vi /etc/samba/smb.conf
   ```
   Change to
   ```
workgroup = WORKGROUP
wins support = yes
   ```
   Must use WORKGROUP not TP-IOT!
   Change
   ```
[homes]
   comment = Home Directories
   browseable = no
   ```
   to
   ```
[homes]
;   comment = Home Directories
;   browseable = no
   ```
   Add:
   ```
[pihome]
   comment= Pi Home
   path=/home/pi
   browseable=Yes
   writeable=Yes
   valid users = pi
   only guest=no
   create mask=0777
   directory mask=0777
   public=no
   read only = no
   force user = root
   ```
   Set the SMB password:
   ```
sudo smbpasswd -a pi
raspberry
sudo service smbd restart
   ```
   Must use "force user = root".
   Must use “valid users = pi".

0. Allow users to set WiFi password from Windows by running /boot/set_wifi_password_from_windows.  We should check at startup whether there is a pending update to the WiFi config.
 
   ```
   crontab -e
   ```
   Add these lines:
   ```
# At every reboot, check whether there are pending updates to the wifi config set by set_wifi_password.
@reboot /home/pi/WiFi/check_wifi_updates.sh
   ```
0. Copy the following files from https://github.com/lupyuen/RaspberryPiImage/blob/master/boot/ to /boot.  These programs allow the user to set the Raspberry Pi wifi credentials by inserting the SD card into Windows, Mac and Linux computers.
   ```
set_wifi_password_from_mac
set_wifi_password_from_pi.py
set_wifi_password_from_windows.exe
   ```

0. set_wifi_password_from_windows.exe was created by running the following command in Windows:
   ```
pyinstaller --onefile set_wifi_password_from_pi.py
   ```
   set_wifi_password_from_mac was created by running the above command in Mac OS.
   
## Install Ajenti Web Console

0. Install Ajenti: http://support.ajenti.org/topics/1121-installing-on-ubuntu/
   ```
sudo bash
wget -O- https://raw.github.com/ajenti/ajenti/1.x/scripts/install-ubuntu.sh | sudo sh
exit
sudo service ajenti restart
   ``` 

0. Update Ajenti config to start at port 80 instead of 8080.  Edit /etc/ajenti/config.json.  Change
   ```
   "port": 8000
   ```
   to
   ```
   "port": 80
   ```
   Change
   ```
   "ssl": {
        "enable": true,
   ```
   to
   ```
   "ssl": {
        "enable": false, 
   ```

0. Browse to
http://raspberrypi/.
Login in as root, password admin
Change the user authentication to sync with local users:

   Configure -> User -> Authentication -> Sync with OS Users

   Ensure pi has all permissions.
   Restart Ajenti, log in as pi, password raspberry.

0. Copy index.html, auth.html, terminal.html from https://github.com/lupyuen/RaspberryPiImage/tree/master/usr/share/pyshared/ajenti/plugins/main to /usr/share/pyshared/ajenti/plugins/main/content/static and /usr/lib/pymodules/python2.7/ajenti/plugins/main/content/static.  This enables Font Awesome to support icons in the text widget, and hides the SSL warning messages.  Also it allows launching of tty.js as our web terminal.

0. Add text widget for tty.js web terminal:
   ```
   <b>Welcome to the Ajenti Web Console</b><br>
   For monitoring and controlling your Raspberry Pi<br>
   <a target='_blank' href='/terminal.html'><span class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i class="fa fa-terminal fa-stack-1x fa-inverse"></i></span></a>
   <a target='_blank' href='/terminal.html'>Open Raspberry Pi Web Terminal</a>
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
   href='https://tp-iot.slack.com/'
   ><b>Slack</b> for realtime collaboration</a><br>
   
   <a target='_blank' href='http://bit.ly/tp-iot'><span 
      class="fa-stack fa-lg"><i class="fa fa-square fa-stack-2x"></i><i 
      class="fa fa-life-ring fa-stack-1x fa-inverse"
      title="FAQ"></i></span></a>
   <a target='_blank' 
   href='http://bit.ly/tp-iot'
   ><b>Frequently Asked Questions</b></a><br>

   ```

##  Install tty.js Web Terminal

0. Install tty.js web terminal: https://github.com/chjj/tty.js/

   ```
cd /tmp
npm init
(Select all defaults)
npm install --save tty.js
sudo mkdir /opt/tty.js
sudo cp package.json /opt/tty.js
sudo cp -r node_modules /opt/tty.js
   ```
   
0. In `/opt/tty.js`, download files run.sh, daemon.sh from https://github.com/lupyuen/RaspberryPiImage/tree/master/opt/tty.js

0. Delete /opt/tty.js/node_modules/tty.js/static/index.html. This file will be rendered after successful token authentication.

0. Copy index.html and tty.js from https://github.com/lupyuen/RaspberryPiImage/tree/master/opt/tty.js/node_modules/tty.js/lib to /opt/tty.js/node_modules/tty.js/lib.  These files implement the token authentication between Ajenti and tty.js.
   
0. Configure tty.js as a service that starts automatically.  Copy tty.js from https://github.com/lupyuen/RaspberryPiImage/tree/master/etc/init.d to /etc/init.d.  Ensure it has execute permission.

0. Install the service:
   ```
   sudo insserv tty.js
   (Reboot the pi)
   sudo service tty.js start
   sudo service tty.js status
   ```
   
   tty.js web-based terminal is now running on port 3000.

## Send Raspberry Pi logs to Sumo Logic 

0. In Sumo Logic, click Manage --> Setup Wizard --> Set Up Streaming Data --> All Other Sources --> Syslog --> New Collector

0. Install collector a EC2 Ubuntu machine (LogServer)

0. On Raspberry Pi, install syslog-ng
   ```
   sudo apt-get install syslog-ng
   sudo vi /etc/syslog-ng/syslog-ng.conf
   ```
   Add Sumo Logic as a log destination:
   ```
   ##  Send logs to Sumo Logic log collector.
destination remote_log_server {
 udp("54.169.166.79" port(514));
 };
 log { source(s_src); destination(remote_log_server); };
   ```
   Restart syslog-ng:
   ```
   sudo service syslog-ng restart
   ```

## Update AWS DNS when local IP address changes

0. Copy https://github.com/lupyuen/RaspberryPiImage/blob/master/home/pi/DNS/update_dns.sh to /home/pi/DNS/update_dns.sh.  This script calls AWS API Gateway to run a Lambda function UpdateDNS that updates the AWS DNS IP address: https://github.com/lupyuen/AWSIOT/blob/master/nodejs/UpdateDNS.js

0. Add task to crontab to update the DNS every minute:
   ```
   crontab -e
   ```
   Add:
   ```
# At every minute, fix the filesystem permissions so that pi user has access to all files in the home directory.
# Network file access may have caused permission problems. Also update the AWS DNS with our local IP address, e.g.
# g88pi.tp-iot.com = 1.2.3.4
* * * * * /home/pi/DNS/fixpermissions.sh & /home/pi/DNS/update_dns.sh
   ```

## Enable Bluetooth Support

0. See http://www.techradar.com/sg/how-to/computing/how-to-get-wi-fi-and-bluetooth-working-on-raspberry-pi-3-1316938
   ```
   sudo apt-get install bluetooth bluez blueman
   ```

## Set up pybluez for scanning beacons

   ```
cd /home/pi
sudo apt install bluetooth bluez blueman
sudo apt install python3-dev
sudo apt install libbluetooth-dev
sudo pip3 install pybluez
sudo apt install libboost-dev
sudo apt install libboost-python-dev
sudo apt install libboost-thread-dev
sudo pip3 install gattlib
wget https://github.com/karulis/pybluez/zipball/master
mv master master.zip
unzip master.zip
cd karulis-pybluez-*/examples/ble
sudo python3 beacon_scan.py
   ```

   beacon_scan.py returns a list of beacons detected:
   ```
Beacon: address:C1:8B:BF:C6:4E:56 uuid:b9407f30-f5f8-466e-aff9-25556b57fe6d major:22094 minor:50879 txpower:182 rssi:-75
Beacon: address:D4:AC:86:66:3A:0D uuid:b9407f30-f5f8-466e-aff9-25556b57fe6d major:3386 minor:26246 txpower:182 rssi:-79
Beacon: address:D8:22:CB:53:63:B0 uuid:b9407f30-f5f8-466e-aff9-25556b57fe6d major:45155 minor:21451 txpower:182 rssi:-83
Beacon: address:F7:43:86:4E:B9:CD uuid:b9407f30-f5f8-466e-aff9-25556b57fe6d major:52665 minor:20102 txpower:182 rssi:-68
Beacon: address:D8:B1:B7:D4:38:AE uuid:b9407f30-f5f8-466e-aff9-25556b57fe6d major:44600 minor:54455 txpower:182 rssi:-79
   ```

   Installation Log:
   https://github.com/lupyuen/AWSIOT/blob/master/install_pybluez.log


## Create NOOBS image from SD card

0. Copy setgroup.sh from https://github.com/lupyuen/RaspberryPiImage/blob/master/boot/setgroup.sh to /boot. This script is used after cloning to set the hostname.

0. Confirm WiFi config
   ```
   sudo vi /etc/wpa_supplicant/wpa_supplicant.conf
   ```

0. Create a large FAT32 LBA partition to store the NOOBS image.  Derived from https://mike632t.wordpress.com/2014/02/10/resizing-partitions/

   ```
sudo fdisk -lu
Device         Boot  Start     End Sectors  Size Id Type
/dev/mmcblk0p1        8192  131071  122880   60M  c W95 FAT32 (LBA)
/dev/mmcblk0p2      131072 7878655 7747584  3.7G 83 Linux
   ```
So the first sector of new partition should be 7878655 + 1 = 7878656
   ```
sudo fdisk /dev/mmcblk0

n for new partition
p for Primary partition type
First sector: 7878656
Last sector: default

p to print partitions

Device         Boot   Start      End  Sectors  Size Id Type
/dev/mmcblk0p1         8192   131071   122880   60M  c W95 FAT32 (LBA)
/dev/mmcblk0p2       131072  7878655  7747584  3.7G 83 Linux
/dev/mmcblk0p3      7878656 31116287 23237632 11.1G 83 Linux

t to change partition type
Partition 3

Device         Boot   Start      End  Sectors  Size Id Type
/dev/mmcblk0p1         8192   131071   122880   60M  c W95 FAT32 (LBA)
/dev/mmcblk0p2       131072  7878655  7747584  3.7G 83 Linux
/dev/mmcblk0p3      7878656 31116287 23237632 11.1G  c W95 FAT32 (LBA)

w to write
sudo reboot
   ```
0. Format as FAT32
   ```
sudo mkfs.vfat /dev/mmcblk0p3
mkdir /tmp/noobs
sudo mount /dev/mmcblk0p3 /tmp/noobs
ls /tmp/noobs
   ```

0. Copy out all files according to https://github.com/raspberrypi/noobs/blob/master/README.md
   ```
sudo su
mkdir /tmp/noobs
sudo mount /dev/mmcblk0p3 /tmp/noobs
cd /
tar -cpf /tmp/noobs/root.tar /* --exclude=proc/* --exclude=sys/* --exclude=dev/pts/* --exclude=tmp/noobs/*
cd /boot
tar -cpf /tmp/noobs/boot.tar .
shutdown now
   ```

0. Compress on a PC or Mac for better performance. Insert the SD card into a powerful PC and run
   ```
xz -9 -e root.tar
xz -9 -e boot.tar
   ```

0. On the PC, download and unzip full version of NOOBS to c:\TP-IoT-NOOBS

0. Edit the recovery.cmdline file in the root NOOBS directory and append silentinstall to the arguments list.

0. Delete the folder C:\TP-IoT-NOOBS\os\Rasbian.  Create folder C:\TP-IoT-NOOBS\os\TP-IoT.

0. Copy the following files from https://github.com/lupyuen/TP-IoT-NOOBS/tree/master/os/TP-IoT to C:\TP-IoT-NOOBS\os\TP-IoT\
   ```
os.json
partition_setup.sh
partitions.json
   ```

0. Copy root.tar.xz, boot.tar.xz to C:\TP-IoT-NOOBS\os\TP-IoT\

0. To install a new SD Card, copy the entire contents of C:\TP-IoT-NOOBS to the SD Card and boot the Pi with the SD Card.  See https://goo.gl/Vrce5E

## Install Custom Domain for API Gateway

Assume that you want to set `api.mydomain.com` as your API Gateway.  We refer to `api.mydomain.com` as `<<API_DOMAIN_NAME>>`.  Setting up a Custom Domain requires an SSL cert.  Let's get the cert from LetsEncrypt.

0. Create an EC2 server running Ubuntu with public incoming HTTP port access. Denote the server IP address by `<<SERVER_IP>>`

0. Update the DNS so that `<<API_DOMAIN_NAME>>` points to the new server: Go to Route 53 --> Hosted Zones --> Domain Name --> Create Record Set.  Set Name to `<<API_DOMAIN_NAME>>`, Type to "A", Alias to "No", Value to `<<SERVER_IP>>`

0. Connect to server, install `certbot` from https://letsencrypt.org/getting-started/ and run `certbot`. 
 ```
ssh -i <<SERVER_KEY>> ubuntu@<<SERVER_IP>>
<<...Install certbot first...>>
sudo certbot certonly
 ```
0. Select "Automatically use a temporary web server". Make sure that ports 80 and 443 are open for incoming access.  Check the EC2 firewall / security group.

0. Enter domain name as `<<API_DOMAIN_NAME>>`

0. The new cert is created at `/etc/letsencrypt/live/<<API_DOMAIN_NAME>>`

0. Go to API Gateway console --> Custom Domain Names --> Create, enter `<<API_DOMAIN_NAME>>`, get the CloudFront domain name. Change the Route 53 record for `<<API_DOMAIN_NAME>>` to be an alias for the CloudFront domain name.

0. Copy the `cert.pem` file contents into Certificate Body

0. Copy the `privkey.pem` file contents into Certificate Private Key

0. Copy the `chain.pem` file contents into Certificate Chain

0. LetsEncrypt certs expire every 3 months, so you need to repeat the above process every 3 months. You can load the new cert as a Backup Cert into API Gateway, then rotate the cert

## For Future Consideration: Install Guacamole VNC web client

From https://sourceforge.net/p/guacamole/discussion/1110834/thread/75fd04f0/
```
apt-get install guacamole-tomcat
apt-get install libguac-client-ssh0
```

## Set up AWS IoT

0. Go to AWS IoT Console, create a Thing, Name=g88pi.

0. Add an attribute "temperature" and set the value to 28 (number, not string).

0. Under the newly-created Thing, click "Connect a Device".  Download the *.private.pem.key and *.certificate.pem.crt files, copy to the root folder of the project.

0. Create a rule named "g88_too_hot".  Use this query: SELECT * FROM '$aws/things/+/shadow/update/accepted' WHERE state.reported.temperature > 25

0. Select "SNS" as the action. Create a new topic and subscribe to it.

0. Run this script. It should trigger an SNS email alert.

## For Future Consideration: Set up LoRa libraries

Based on https://www.cooking-hacks.com/documentation/tutorials/extreme-range-lora-sx1272-module-shield-arduino-raspberry-pi-intel-galileo/

```
cd /home/pi
wget http://www.cooking-hacks.com/media/cooking/images/documentation/raspberry_arduino_shield/raspberrypi2.zip && unzip raspberrypi2.zip && cd cooking/arduPi && chmod +x install_arduPi && ./install_arduPi && rm install_arduPi && cd ../..

cd /home/pi
wget http://www.cooking-hacks.com/media/cooking/images/documentation/tutorial_SX1272/arduPi-api_LoRa_v1_4.zip && unzip -u arduPi-api_LoRa_v1_4.zip && cd cooking/examples/LoRa && chmod +x cook.sh && cd ../../..  
```

Build arduPiLoRa:
```
cd /home/pi/cooking/examples/LoRa/ 
rm -f /home/pi/cooking/libraries/arduPiLoRa/arduPiLoRa.o
./cook.sh
## Previously: ./cook.sh lora_interface.cpp 

cd /home/pi/LoRa

g++ -lrt -lpthread -lstdc++ lora_interface.cpp /usr/local/lib/libmsgpackc.a /home/pi/cooking/libraries/arduPiLoRa/arduPiLoRa.o /home/pi/cooking/arduPi-api/arduPiUART.o /home/pi/cooking/arduPi-api/arduPiUtils.o /home/pi/cooking/arduPi-api/arduPiMultiprotocol.o /home/pi/cooking/arduPi/arduPi.o -I/home/pi/cooking/arduPi -I/home/pi/cooking/arduPi-api -I/home/pi/cooking/libraries/arduPiLoRa -o lora_interface.cpp_exe

sudo ./lora_interface.cpp_exe 

```

Build Python3 interface for lora_interface using swig.  Based on http://www.swig.org/tutorial.html:
```
sudo apt install swig

cd /home/pi/LoRa
swig -python lora_interface.i

g++ -c lora_interface.cpp lora_interface_wrap.c -I/home/pi/cooking/arduPi -I/home/pi/cooking/arduPi-api -I/home/pi/cooking/libraries/arduPiLoRa -I /usr/include/python3.4 

ld -shared -lrt -lpthread -lstdc++ -L /usr/lib/gcc/arm-linux-gnueabihf/4.9 lora_interface.o lora_interface_wrap.o /home/pi/cooking/libraries/arduPiLoRa/arduPiLoRa.o /home/pi/cooking/arduPi-api/arduPiUART.o /home/pi/cooking/arduPi-api/arduPiUtils.o /home/pi/cooking/arduPi-api/arduPiMultiprotocol.o /home/pi/cooking/arduPi/arduPi.o /usr/local/lib/libmsgpackc.a -o _lora_interface.so

sudo python3 test_lora_interface.py

```

## Auto start the LoRa gateway and nodes

For gateway:
```
crontab -e
#### Start LoRa node at startup.
@reboot /home/pi/LoRa/run_lora_gateway.sh
```

For node:
```
crontab -e
#### Start LoRa node at startup.
@reboot /home/pi/LoRa/run_lora_node.sh
```

## Setup Dragino LoRa GPS HAT

```
sudo apt install wiringpi
```




