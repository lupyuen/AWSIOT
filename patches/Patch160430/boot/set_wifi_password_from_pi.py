from string import Template
import os
import sys
import getpass
import passlib.hash
import passlib.handlers
import passlib.handlers.windows

program_path = os.path.dirname(os.path.realpath(sys.argv[0]))

wpa_template = '''
network={
    ssid="$ssid"
    psk="$password"
    key_mgmt=WPA-PSK
}
'''
tp_template = '''
network={
    ssid="TP-Secure"
    scan_ssid=1
    key_mgmt=WPA-EAP
    pairwise=CCMP TKIP
    group=CCMP TKIP
    eap=PEAP
    identity="$userid"
    password=hash:$password
    phase2="MSCHAPV2"
}
'''
startup_message = '''\n\n
TP WiFi Configuration Utility (Version 1.0 21 Apr 2016)
=======================================================\n
This utility configures your Raspberry Pi to connect to the
TP-Secure WiFi network or to your home WiFI network.

Would you like to configure your Raspberry Pi for
[1] TP-Secure WiFi network
[2] Home WiFi network?

Select 1 or 2 and press Enter:'''
tp_message = '''
At the prompt, please enter your TP user ID and password.\n
Your password will be encrypted and stored temporarily in the
microSD Card.\n
When you boot your Raspberry Pi with this microSD Card, your
user ID and encrypted password will be transferred to the
Raspberry Pi operating system.\n
Your password will be deleted from the microSD Card after the transfer.\n
'''


def main():
    print(program_path)
    choice = input(startup_message)
    if choice == '1':
        configuretp()
    elif choice == '2':
        configurehome()
    input("Press Enter to exit...")

def configuretp():
    print(tp_message)
    userid, password = getpassword('Enter your TP User ID:',
                                          'Enter your TP Password:',
                                          'Retype your TP Password:')
    hashed_password = nthash(password)
    filename = 'pending_wifi_config_TP-Secure'
    with open(program_path + '/' + filename, 'w') as out:
        out.write(Template(tp_template).substitute(userid=userid, password=hashed_password))
    print("\nYour password has been encrypted and stored temporarily\n"
    "in the microSD Card. Please boot your Raspberry Pi now with this\n"
    "microSD Card to set the WiFi password.\n\n")

def configurehome():
    ssid, password = getpassword('Enter your home WiFi SSID:',
                                 'Enter your home WiFI Password:',
                                 'Retype your home WiFi Password:')
    filename = 'pending_wifi_config_' + ssid
    with open(program_path + '/' + filename, 'w') as out:
        out.write(Template(wpa_template).substitute(ssid=ssid, password=password))
    print("\nYour password has been stored temporarily in the microSD Card.\n"
    "Please boot your Raspberry Pi now with this microSD Card to set the WiFi password.\n\n")

def nthash(s):
    return passlib.hash.nthash.encrypt(s).upper()

def getpassword(prompt1, prompt2, prompt3):
    user = input(prompt1)
    if not user:
        user = getpass.getuser()
    pprompt = lambda: (getpass.getpass(prompt2), getpass.getpass(prompt3))
    password1, password2 = pprompt()
    while password1 != password2:
        print('Passwords do not match. Try again')
        password1, password2 = pprompt()
    return user, password1

main()
