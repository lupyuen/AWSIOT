# https://github.com/lupyuen/AWSIOT/blob/master/python/SendSMS.py
# Send an SMS by calling the Hoiio REST API.  Expects:
#   phone: 8-digit phone numer
#   message: Message to be sent

import datetime
from urllib import urlencode
from urllib2 import urlopen

# App ID and access token for Lup Yuen's Hoiio account.
HOIIO_APP_ID = "2CZ2EdRbmL0uDDmB"
HOIIO_ACCESS_TOKEN = "3gDMuaBD1pUkp6qo"
HOIIO_URL = "https://secure.hoiio.com/open/sms/send?"

# Record the last time we sent to each phone.
last_sent_by_phone = {}


def lambda_handler(event, context):
    global last_sent_by_phone
    phone = event.get("phone")
    message = event.get("message")
    if phone is None:
        raise RuntimeError("Missing parameter for phone")
    if message is None:
        raise RuntimeError("Missing parameter for message")
        
    # Don't allow any SMS and calls to 12345.
    if "12345" in phone:
        raise RuntimeError("Invalid phone number " + phone)

    # Phone must be numeric, 8 digits.
    if len(phone) == 8:
        phone = "65" + phone
    if len(phone) == 10 and phone[0] != "+":
        phone = "+" + phone

    # Allow max 1 message per min to the same phone.
    last_sent = last_sent_by_phone.get(phone)
    print("last_sent=" + str(last_sent))
    if last_sent is not None:
        seconds_since_last_sent = (datetime.datetime.now() - last_sent).total_seconds()
        if seconds_since_last_sent <= 60:
            raise RuntimeError("Can't send to same phone " + phone + 
                " within 1 minute. Try again later.")
    last_sent_by_phone[phone] = datetime.datetime.now()
    
    # Compose the REST request to Hoiio.
    url2 = HOIIO_URL + urlencode({
        "app_id": HOIIO_APP_ID,
        "access_token": HOIIO_ACCESS_TOKEN,
        "dest": phone,  # Must start with + and country code (e.g. 65)
        "msg": message
    })
    print("Sending REST request to Hoiio: " + url2)
    try:
        # Send the REST request to Hoiio.
        response = urlopen(url2).read()
        if "success_ok" not in str(response):
            raise RuntimeError("Hoiio request failed: " + str(response))
    except:
        print('Hoiio request failed')
        raise
    else:
        print('Response from Hoiio: ' + str(response))
        return response
        
