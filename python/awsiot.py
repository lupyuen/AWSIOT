import ssl

__author__ = 'Luppy'

import paho.mqtt.client as mqtt


# The callback for when the client receives a CONNACK response from the server.
def on_connect(client2, userdata, flags, rc):
    print("Connected with result code " + str(rc))

    # Subscribing in on_connect() means that if we lose the connection and
    # reconnect then subscriptions will be renewed.
    client2.subscribe("$aws/things/g0_temperature_sensor/shadow/update/accepted")

    payload = '{"state":{"reported":{"timestamp":"2015-10-11T16:52:01.514Z","temperature":88}}}'
    client2.publish("$aws/things/g0_temperature_sensor/shadow/update", payload)


# The callback for when a PUBLISH message is received from the server.
def on_message(client2, userdata, msg):
    print(msg.topic + " " + str(msg.payload))


def on_log(client2, userdata, level, buf):
    print("Log: " + buf)


client = mqtt.Client("myAwsClientId")
client.on_connect = on_connect
client.on_message = on_message
client.on_log = on_log

# Set the certificates and private key for connecting to AWS IoT.
client.tls_set("../aws-iot-rootCA.crt", "../5c46ea701f-certificate.pem.crt", "../5c46ea701f-private.pem.key",
               ssl.CERT_REQUIRED, ssl.PROTOCOL_TLSv1_2)

# Connect to AWS IoT server.  Use AWS command line "aws iot describe-endpoint" to get the address.
client.connect("A1P01IYM2DOZA0.iot.us-west-2.amazonaws.com", 8883, 60)

# Blocking call that processes network traffic, dispatches callbacks and
# handles reconnecting.
# Other loop*() functions are available that give a threaded interface and a
# manual interface.
client.loop_forever()
