import ssl
import json
import datetime
import paho.mqtt.client as mqtt

# TODO: Name of our Raspberry Pi, also known as our "Thing Name"
#deviceName = "g88_pi"
deviceName = "g0_temperature_sensor"
# TODO: Public certificate of our Raspberry Pi, as provided by AWS IoT.
deviceCertificate = "5c46ea701f-certificate.pem.crt"
# TODO: Private key of our Raspberry Pi, as provided by AWS IoT.
devicePrivateKey = "5c46ea701f-private.pem.key"
# Root certificate to authenticate AWS IoT when we connect to their server.
awsCert = "aws-iot-rootCA.crt"

# This is called when we are connected to AWS IoT via MQTT.
def on_connect(client2, userdata, flags, rc):
    # Subscribe to our MQTT topic so that we will receive notifications of updates.
    client2.subscribe("$aws/things/" + deviceName + "/shadow/update")
    # Prepare our sensor data in JSON format.
    payload = json.dumps({
        "state": {
            "reported": {
                "timestamp": datetime.datetime.now().isoformat(),
                "temperature": 28
            }
        }
    })
    print("Sending sensor data to AWS IoT: ", payload)

    # Publish our sensor data to AWS IoT via the MQTT topic, also known as updating our "Thing Shadow".
    client2.publish("$aws/things/" + deviceName + "/shadow/update", payload)
    print("Sent to AWS IoT")


# This is called when we receive a subscription notification from AWS IoT.
def on_message(client2, userdata, msg):
    print(msg.topic + " " + str(msg.payload))


# Print out log messages for tracing.
def on_log(client2, userdata, level, buf):
    print("Log: " + buf)

# Create an MQTT client for connecting to AWS IoT via MQTT.
client = mqtt.Client("awsiot")
client.on_connect = on_connect
client.on_message = on_message
client.on_log = on_log

# Set the certificates and private key for connecting to AWS IoT.  TLS 1.2 is mandatory for AWS IoT and is supported
# only in Python 3.4 and later, compiled with OpenSSL 1.0.1 and later.
client.tls_set(awsCert, deviceCertificate, devicePrivateKey, ssl.CERT_REQUIRED, ssl.PROTOCOL_TLSv1_2)

# Connect to AWS IoT server.  Use AWS command line "aws iot describe-endpoint" to get the address.
client.connect("A1P01IYM2DOZA0.iot.us-west-2.amazonaws.com", 8883, 60)

# Loop forever processing the MQTT network commands, including auto-reconnection.
client.loop_forever()

