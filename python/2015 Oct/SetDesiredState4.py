from __future__ import print_function
import boto3, json, ast, datetime, sys, os, hashlib, hmac, urllib2, base64, pickle

print('Loading function')

# List of device names and the replacement Slack channels for the device.
# Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and
# SendSensorDataToElasticsearch.
replaceSlackChannels = {
    "g16-pi": "g16",
    "g16b-pi": "g16",
    "g29": "g29a",
    "g88": "g88a"
}

# Log on to AWS as lambda_iot_user.
aws_session = boto3.Session(aws_access_key_id='AKIAIAAXOWVF3FX2XBZA',
                            aws_secret_access_key='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',
                            region_name='us-west-2')
# Get AWS S3 client.
s3_client = aws_session.client('s3')


def lambda_handler(event, context):
    # Look for the device with the provided device ID and set its desired state.
    print("Received event: " + json.dumps(event, indent=2))
    device = event.get("device")
    attribute = event.get("attribute")
    value = event.get("value")
    timestamp = event.get("timestamp")
    if timestamp is None:
        timestamp = datetime.datetime.now().isoformat()
        event["timestamp"] = timestamp
    set_desired_state(device, attribute, value, timestamp)
    return "OK"


# Update the thing's desired state.
def set_desired_state(device2, attribute2, value2, timestamp2):
    payload = {
        "state": {
            "desired": {
                attribute2: value2,
                "timestamp": timestamp2
            }
        }
    }
    # Post to Slack and AWS.
    print("Payload: " + json.dumps(payload))
    post_state_to_slack(device2, payload)
    iot_client = aws_session.client('iot-data')
    response = iot_client.update_thing_shadow(
        thingName=device2,
        payload=json.dumps(payload).encode("utf-8")
    )
    print("update_thing_shadow: ", response)
    # Check the server response for success/failure.
    if str(response).find("'HTTPStatusCode': 200") > 0:
        slackResult = {"color": "good",
                       "title": "Device has set desired state successfully"}
    else:
        slackResult = {"color": "danger",
                       "title": "Error: Device failed to set desired state"}
    # Post the result to Slack.
    slackResult["fallback"] = slackResult["title"]
    post_to_slack(device2, [slackResult])
    return response


def post_state_to_slack(device, state):
    # Post the set desired/reported state payload to the Slack channel of the
    # same name as the device e.g. #g88.
    state2 = state.get("state")
    if state2 is None:
        return
    # Check whether we are setting the desired or reported state.
    kind = None
    state3 = state2.get("desired")
    if state3 is not None:
        kind = "desired"
    else:
        state3 = state2.get("reported")
        if state3 is not None:
            kind = "reported"
    if kind is None:
        return
    fields = []
    for key in state3:
        fields = fields + [{
            "title": key + ":",
            "value": "```" + str(state3[key]) + "```",
            "short": True
        }]
    attachment = {
        "mrkdwn_in": ["text", "fields"],
        "fallback": "Setting " + kind + " state: " + json.dumps(state),
        "color": "warning",
        "title": "Setting " + kind + " state",
        "text": ":open_file_folder: _state:_ :open_file_folder: _" + kind + ":_\n" + \
                "_:wavy_dash::wavy_dash::wavy_dash::wavy_dash::wavy_dash::wavy_dash::wavy_dash::wavy_dash::wavy_dash:_",
        "fields": fields
    }
    post_to_slack(device, [attachment])


def post_to_slack(device, textOrAttachments):
    # Post a Slack message to the channel of the same name as the device e.g. #g88.
    # device is assumed to begin with the group name.  action is the message.
    if device is None:
        return
    channel = "g88a"
    # If device is g88_pi, then post to channel #g88.
    pos = device.find("_")
    if pos > 0:
        channel = device[0:pos]
    # Map the channel name in case the channel name is unavailable.
    if replaceSlackChannels.get(device) is not None:
        channel = replaceSlackChannels.get(device)
    elif replaceSlackChannels.get(channel) is not None:
        channel = replaceSlackChannels.get(channel)
    # Construct the REST request to Slack.
    body = {
        "channel": "#" + channel,  # Public channels always start with #
        "username": device
    }
    # If message is a string, send as text. Else assume it's in Slack Attachment format.
    if len(textOrAttachments[0]) == 1:
        body["text"] = textOrAttachments
    else:
        body["attachments"] = textOrAttachments
    print(json.dumps(body, indent=2))
    url = "https://hooks.slack.com/services/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"
    try:
        # Make the REST request to Slack.
        request = urllib2.Request(url, json.dumps(body))
        result2 = urllib2.urlopen(request).read()
        print("result = " + result2)
        return result2
    except urllib2.HTTPError, error:
        # Show the error.
        error_content = error.read()
        print("error = " + error_content)


