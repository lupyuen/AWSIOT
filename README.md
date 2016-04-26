# AWS IoT with Raspberry Pi, Node.js and Python
Node.js and Python scripts for AWS IoT, used in Temasek Polytechnic Smart IoT Applications course. See also:

- https://github.com/lupyuen/RaspberryPiImage
- https://www.facebook.com/photo.php?fbid=10203864039081512&set=a.1222080012259.25950.1836747147&type=3&theater

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

0. On Pi 3: We must disable Bluetooth else the console cable won't work: https://www.abelectronics.co.uk/kb/article/1035/raspberry-pi-3-serial-port-usage
   ```
sudo apt-get update
sudo apt-get upgrade
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

0. Click Menu -> Preferences -> Raspberry Pi Configuration.  Click Interfaces. Enable SSH, SPI, I2C and Serial.  Reboot.

0. Set the locale:
   ```
sudo vi /etc/environment
   ```
   Set to this:
   ```
LC_CTYPE=en_SG.UTF-8
LC_ALL=en_SG.UTF-8
LANG=en_SG.UTF-8
   ```
   Generate the locale files:
   ```
sudo dpkg-reconfigure locales
   ```
   Select "en_SG.UTF-8 UTF-8".
   Set default locale for system environment to "en_SG.UTF-8".

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

0. Automatically start pigpiod background process during boot time
   ```
   crontab -e
   ```
   Add these lines:
   ```
# At every reboot, start the pigpiod backgroud process needed for accessing the DHT22 temperature+humidity sensor.
@reboot sudo pigpiod
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

## Encrypt wifi password and connect to WPA2 Enterprise network

0. See https://www.raspberrypi.org/forums/viewtopic.php?f=36&t=44029

   Check WPA support:
   ```
sudo cp /etc/network/interfaces /etc/network/interfaces.old
sudo vi /etc/network/interfaces
   ```
   Change
   ```
auto lo
iface lo inet loopback

iface eth0 inet manual

allow-hotplug wlan0
iface wlan0 inet manual
    wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf

allow-hotplug wlan1
iface wlan1 inet manual
    wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf
   ```
   to
   ```
auto lo

iface lo inet loopback
iface eth0 inet dhcp

allow-hotplug wlan0

iface wlan0 inet dhcp
        pre-up wpa_supplicant -B -Dwext -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf -f /var/log/wpa_supplicant.log
        post-down killall -q wpa_supplicant
   ```
   Add WPA2 Enterprise network:
   ```
sudo vi /etc/wpa_supplicant/wpa_supplicant.conf
   ```
   Add to file:
   ```
network={
      ssid="YOUR_SSID"
      scan_ssid=1
      key_mgmt=WPA-EAP
      pairwise=CCMP TKIP
      group=CCMP TKIP
      eap=PEAP
      identity="YOUR_USERID"
      password=hash:YOUR_HASHED_PASSWORD
      phase2="MSCHAPV2"
}
   ```

   For hashing of password: https://bbs.archlinux.org/viewtopic.php?id=144471
   
   YOUR_HASHED_PASSWORD is the result of
   ```
echo -n mypasswordwithescapedspecialcharacters | iconv -t utf-16le | openssl md4
   ```

   Restart network and check for errors:
   ```
   sudo reboot
   cat /var/log/wpa_supplicant.log
   ```
   You should see:
   ```
   Successfully initialized wpa_supplicant
wlan0: Trying to associate with 00:1a:1e:a0:9e:c0 (SSID='???' freq=2462 MHz)
wlan0: Association request to the driver failed
wlan0: Associated with 00:1a:1e:a0:9e:c0
wlan0: CTRL-EVENT-EAP-STARTED EAP authentication started
wlan0: CTRL-EVENT-EAP-PROPOSED-METHOD vendor=0 method=25
wlan0: CTRL-EVENT-EAP-METHOD EAP vendor 0 method 25 (PEAP) selected
wlan0: CTRL-EVENT-EAP-PEER-CERT depth=3 subject='/C=US/O=Entrust, Inc./OU=www.entrust.net/CPS is incorporated by reference/OU=(c) 2006 Entrust, Inc./CN=Entrust Root Certification Authority'
wlan0: CTRL-EVENT-EAP-PEER-CERT depth=3 subject='/C=US/O=Entrust, Inc./OU=www.entrust.net/CPS is incorporated by reference/OU=(c) 2006 Entrust, Inc./CN=Entrust Root Certification Authority'
wlan0: CTRL-EVENT-EAP-PEER-CERT depth=2 subject='/C=US/O=Entrust, Inc./OU=See www.entrust.net/legal-terms/OU=(c) 2009 Entrust, Inc. - for authorized use only/CN=Entrust Root Certification Authority - G2'
wlan0: CTRL-EVENT-EAP-PEER-CERT depth=1 subject='/C=US/O=Entrust, Inc./OU=See www.entrust.net/legal-terms/OU=(c) 2012 Entrust, Inc. - for authorized use only/CN=Entrust Certification Authority - L1K'
wlan0: CTRL-EVENT-EAP-PEER-CERT depth=0 subject='/C=??/ST=???/L=???/O=???/CN=??-radius01.??.???.??'
EAP-MSCHAPV2: Authentication succeeded
EAP-TLV: TLV Result - Success - EAP-TLV/Phase2 Completed
wlan0: CTRL-EVENT-EAP-SUCCESS EAP authentication completed successfully
wlan0: WPA: Key negotiation completed with 00:1a:1e:a0:9e:c0 [PTK=CCMP GTK=TKIP]
wlan0: CTRL-EVENT-CONNECTED - Connection to 00:1a:1e:a0:9e:c0 completed [id=1 id_str=]
wlan0: CTRL-EVENT-DISCONNECTED bssid=00:1a:1e:a0:9e:c0 reason=0
wlan0: Trying to associate with 00:1a:1e:a0:9e:80 (SSID='???' freq=2462 MHz)
wlan0: Association request to the driver failed
wlan0: Associated with 00:1a:1e:a0:9e:80
wlan0: CTRL-EVENT-EAP-STARTED EAP authentication started
wlan0: CTRL-EVENT-EAP-PROPOSED-METHOD vendor=0 method=25
wlan0: CTRL-EVENT-EAP-METHOD EAP vendor 0 method 25 (PEAP) selected
EAP-TLV: TLV Result - Success - EAP-TLV/Phase2 Completed
wlan0: CTRL-EVENT-EAP-SUCCESS EAP authentication completed successfully
wlan0: WPA: Key negotiation completed with 00:1a:1e:a0:9e:80 [PTK=CCMP GTK=TKIP]
wlan0: CTRL-EVENT-CONNECTED - Connection to 00:1a:1e:a0:9e:80 completed [id=1 id_str=]
   ```

0. Allow users to set WiFi password from Windows by running /boot/set_wifi_password_from_windows.  We should check at startup whether there is a pending update to the WiFi config.
 
   ```
   crontab -e
   ```
   Add these lines:
   ```
# At every reboot, check whether there are pending updates to the wifi config set by set_wifi_password.
@reboot /home/pi/WiFi/check_wifi_updates.sh
   ```

## Install Ajenti Web Console

0. Install Ajenti: http://support.ajenti.org/topics/1116-installing-on-debian/
   ```
sudo bash
wget -O- https://raw.github.com/ajenti/ajenti/1.x/scripts/install-debian.sh | sh
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

0. Browse to
http://raspberrypi/.
Login in as root, password admin
Change the user authentication to sync with local users.  Ensure pi has all permissions.
Log out and log in as pi, password raspberry.

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
npm install tty.js
sudo mkdir /opt/tty.js
sudo cp -r node_modules /opt/tty.js
   ```
0. Add files run.sh, daemon.sh from https://github.com/lupyuen/RaspberryPiImage/tree/master/opt/tty.js

0. Delete /opt/tty.js/node_modules/tty.js/static/index.html. This file will be rendered after successful token authentication.

0. Copy index.html and tty.js from https://github.com/lupyuen/RaspberryPiImage/tree/master/opt/tty.js/node_modules/tty.js/lib to /opt/tty.js/node_modules/tty.js/lib.  These files implement the token authentication between Ajenti and tty.js.
   
0. Configure tty.js as a service that starts automatically.  Copy tty.js from https://github.com/lupyuen/RaspberryPiImage/tree/master/etc/init.d to /etc/init.d.  Ensure it has execute permission.

0. Install the service:
   ```
   sudo insserv tty.js
   sudo service tty.js start
   sudo service tty.js status
   ```

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

## Create NOOBS image from SD card

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

0. Copy and compress all files according to https://github.com/raspberrypi/noobs/blob/master/README.md
   ```
sudo su
cd /
tar -cvpf /tmp/noobs/os.tar /* --exclude=proc/* --exclude=sys/* --exclude=dev/pts/* --exclude=tmp/noobs/*
cd /boot
tar -cvpf /tmp/noobs/boot.tar .
cd /tmp/noobs
xz -9 -e os.tar
xz -9 -e boot.tar
shutdown now
   ```
0. Go to a PC.  Download and unzip full version of NOOBS to c:\NOOBS

0. Edit the recovery.cmdline file in the root NOOBS directory and append silentinstall to the arguments list.

0. Copy ??? to c:\NOOBS\???

## TODO: Setup AWS menubar

## TODO: Hoiio

## TODO: Web Terminal vs SSH Command Line

## TODO: AWS IoT Certs

## TODO: Sumo Logic vs Elasticsearch/Kibana

## TODO: Set up AWS IoT

0. Go to AWS IoT Console, create a Thing named "g0_temperature_sensor".  (Will be renamed to "g88_temperature_sensor".)

0. Add an attribute "temperature" and set the value to 28 (number, not string).

0. Under the newly-created Thing, click "Connect a Device".  Download the *.private.pem.key and *.certificate.pem.crt files, copy to the root folder of the project.

0. Create a rule named "g88_too_hot".  Use this query: SELECT * FROM '$aws/things/+/shadow/update/accepted' WHERE state.reported.temperature > 25

0. Select "SNS" as the action. Create a new topic and subscribe to it.

0. Run this script. It should trigger an SNS email alert.





