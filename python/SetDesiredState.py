from __future__ import print_function
import boto3, json, datetime, urllib2, os

print('Loading function')

# List of device names and the replacement Slack channels for the device.
# Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and
# SendSensorDataToElasticsearch.
replaceSlackChannels = {
    "g88": "g88a"
}

'''
Log on to AWS as lambda_iot_user.  lambda_iot_user must be attached to policy LambdaExecuteIoTUpdate, defined as:
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
aws_session = boto3.Session(aws_access_key_id='AKIAJE7ODGU4E5RJQC5Q',
                            aws_secret_access_key='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',
                            region_name='us-west-2')


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
    # Post to Slack.
    post_state_to_slack(device2, payload)

    # Post to AWS.
    print("\nSending to AWS: " + json.dumps(payload, indent=4, separators=(',', ': ')))
    iot_client = aws_session.client('iot-data')  # Create a client for AWS IoT Data API.
    response = iot_client.update_thing_shadow(   #  Update the AWS IoT thing shadow, i.e. set the device state.
        thingName=device2,
        payload=json.dumps(payload).encode("utf-8")
    )

    # Show AWS response.
    print("\nResponse from AWS update_thing_shadow: ", str(response))
    if response.get('payload') is not None:
        payload2 = json.loads(response.get('payload').read().decode("utf-8"))  # Parse payload text to JSON.
        print("\nResponse Payload: ", json.dumps(payload2, indent=4, separators=(',', ': ')))  # Show formatted JSON.

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
    print("\nSending to Slack: ", json.dumps(body, indent=2))
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
    # Test Case: Set the LED attribute of the device.
    event0 = {
        "device": "g88pi",
        "attribute": "led",
        "value": "on"
    }
    # Start the lambda function.
    lambda_handler(event0, {})
