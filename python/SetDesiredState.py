'''
This lambda function sets the desired state of a device and sensor (attribute).  The input looks like:
{
  "device": "g88pi",
  "attribute": "led",
  "value": "flash3"
}
Or for Slack commands:
{
  "channel_name": "g88a",
  "user_name": "lupyuen",
  "text": "led+flash1"
}

This lambda function must be run as role lambda_iot.  lambda_iot must be attached to policy LambdaExecuteIoTUpdate, defined as:
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "iot:GetThingShadow",
                "iot:UpdateThingShadow"
            ],
            "Resource": [
                "*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kinesis:GetRecords",
                "kinesis:GetShardIterator",
                "kinesis:DescribeStream",
                "kinesis:ListStreams"
            ],
            "Resource": [
                "*"
            ]
        }
    ]
}
'''
from __future__ import print_function
import boto3, json, datetime, urllib2, os

print('Loading function')

# List of device names and the replacement Slack channels for the device.
# Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and
# SendSensorDataToElasticsearch.
replaceSlackChannels = {
    "g88": "g88a"
}

# Log on to AWS as lambda_iot_user.  lambda_iot_user must be attached to policy LambdaExecuteIoTUpdate, defined above.
aws_session = boto3.Session(aws_access_key_id='AKIAJE7ODGU4E5RJQC5Q',
                            aws_secret_access_key='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',
                            region_name='us-west-2')


def lambda_handler(event, context):
    # Look for the device with the provided device ID and set its desired state.
    print("Received event: " + json.dumps(event))
    if event.get("channel_name") is not None:
        # This is a Slack message.
        return slack_handler(event, context)
    else:
        # This is a REST call.
        return rest_handler(event, context)


def rest_handler(event, context):
    # Handle a REST command received from the REST channels except Slack.
    # Look for the device with the provided device ID and set its desired state.
    print("Received REST event: " + json.dumps(event))
    device = event.get("device")
    attribute = event.get("attribute")
    value = event.get("value")
    timestamp = event.get("timestamp")
    if timestamp is None:
        timestamp = datetime.datetime.now().isoformat()
        event["timestamp"] = timestamp
    set_desired_state(device, attribute, value, timestamp)
    return "OK"


def slack_handler(event, context):
    # Handle a user command received from Slack.
    # Look for the device with the provided device ID and set its desired state.
    print("Received Slack event: " + json.dumps(event))

    # Don't respond to a message that this function has posted previously,
    # because we will be stuck in a loop.
    if event.get("user_name") == "slackbot":
        print("Ignoring my own message")
        return {}

    # We will receive a command that looks like "led+flash1", because space gets encoded to +.
    # We split the command by +.
    user_command = event.get("text")
    user_command_split = user_command.split("+")
    if len(user_command_split) != 2:
        print("Bad command")
        return {"text": "Sorry I don't understand your command. " +
                        "Please enter a valid command like 'led flash1'."}

    # Derive the device name from the channel, e.g. channel g88 refers to device g88pi.
    # Also handle channels that have been renamed.
    channel = event.get("channel_name")
    device = channel
    for original_channel in replaceSlackChannels:
        replace_channel = replaceSlackChannels[original_channel]
        if replace_channel == channel:
            device = original_channel
            break
    device = device + "pi"

    # Pass to the REST function to handle.
    event["device"] = device
    event["attribute"], event["value"] = user_command_split  # e.g. attribute=led, value=flash1
    event["timestamp"] = None  # Remove the timestamp.
    result = rest_handler(event, context)
    return {}


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
    # Post to Slack.
    post_state_to_slack(device2, payload)

    # Post to AWS.
    print("\nSending to AWS: " + json.dumps(payload))
    iot_client = aws_session.client('iot-data')  # Create a client for AWS IoT Data API.
    response = iot_client.update_thing_shadow(   #  Update the AWS IoT thing shadow, i.e. set the device state.
        thingName=device2,
        payload=json.dumps(payload).encode("utf-8")
    )

    # Show AWS response.
    print("\nResponse from AWS update_thing_shadow: ", str(response))
    if response.get('payload') is not None:
        payload2 = json.loads(response.get('payload').read().decode("utf-8"))  # Parse payload text to JSON.
        print("\nResponse Payload: ", json.dumps(payload2))  # Show formatted JSON.

    # Check the AWS response for success/failure.
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

    # Format the message nicely for Slack.
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
    # Send the formatted message to Slack.
    post_to_slack(device, [attachment])


def post_to_slack(device, textOrAttachments):
    # Post a Slack message to the channel of the same name as the device e.g. #g88.
    # device is assumed to begin with the group name.  action is the message.
    if device is None:
        return
    channel = "g88a"

    # If device is g88pi, then post to channel #g88.
    pos = device.find("pi")
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
    print("\nSending to Slack: ", json.dumps(body))
    url = "https://hooks.slack.com/services/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"
    try:
        # Make the REST request to Slack.
        request = urllib2.Request(url, json.dumps(body))
        result2 = urllib2.urlopen(request).read()
        print("\nResponse from Slack: " + result2)
        return result2

    except urllib2.HTTPError, error:
        # Show the error.
        error_content = error.read()
        print("Slack Error: " + error_content)


# The main program starts here.  If this program is not started via AWS Lambda, we execute a test case.
if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") is None:
    # Test Case 1: Set the LED attribute of the device when called through API Gateway / REST service.
    event1 = {
        "device": "g88pi",
        "attribute": "led",
        "value": "on"
    }
    # Test Case 2: Same as Test Case 1, except that the command is triggered by user typing a Slack command.
    event2 = {
        "channel_name": "g88a",
        "user_name": "lupyuen",
        "text": "led+flash1"
    }
    # Test Case 3: Same as Test Case 2.
    event3 = {
        "http-method": "POST",
        "text": "led+flash4",
        "api-key": "",
        "team_id": "T09SXGWKG",
        "team_domain": "tp-iot",
        "api-id": "1xt9kv75ii",
        "user-arn": "",
        "account-id": "",
        "user_id": "U09SXEZ60",
        "channel_id": "C0DBYP4LQ",
        "source-ip": "52.90.33.223",
        "user-agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
        "resource-path": "/ActuateDeviceFromSlack",
        "user_name": "lupyuen",
        "timestamp": "1463173799.000071",
        "user": "",
        "resource-id": "6kilk3",
        "stage": "prod",
        "request-id": "0d8c5433-194f-11e6-b830-638262ac861f",
        "caller": "",
        "channel_name": "g88a",
        "token": "EaCNnfmwGnnL2E0Bh6CTAH6r",
        "service_id": "13328414355"
    }
    # Start the lambda function.
    lambda_handler(event2, {})
