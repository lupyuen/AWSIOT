# This lambda function is called by Slack via AWS API Gateway when the user
# types a message into the channel for a device (e.g. channel #g88).
# We watch out for actuator commands like "led flash1" and send them to AWS IoT via AWS Kinesis.

import json
import os
import boto3

print('Loading function...')

# List of device names and the replacement Slack channels for the device.
# Used if the channel name is already taken up.  Sync this with SetDesiredState.
replaceSlackChannels = {
    "g88": "g88a"
}


def lambda_handler(event, context):
    print("Received event: " + json.dumps(event, indent=2))

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

    # Derive the device name from the channel, e.g. channel g88 refers to device g88_pi.
    # Also handle channels that have been renamed.
    channel = event.get("channel_name")
    device = channel
    for original_channel in replaceSlackChannels:
        replace_channel = replaceSlackChannels[original_channel]
        if replace_channel == channel:
            device = original_channel
            break
    device = device + "pi"

    # Compose the desired state that we will send to SetDesiredState via Kinesis.
    desired_state = {
        "device": device,
        "attribute": user_command_split[0],  # e.g. led
        "value": user_command_split[1]  # e.g. flash1
    }
    print("Desired state: " + json.dumps(desired_state, indent=2))

    # Send the desired state to Kinesis.
    partition_key = device
    kinesis_client = boto3.client('kinesis')
    kinesis_response = kinesis_client.put_record(
        StreamName='SetDesiredStateStream',
        Data=json.dumps(desired_state),
        PartitionKey=partition_key)
    print("Kinesis response: " + json.dumps(kinesis_response, indent=2))

    # Compose the response to be displayed in Slack.
    message = "Setting desired state of " + \
              desired_state["attribute"] + " to " + desired_state["value"] + "..."
    result = {
        "username": device,
        "text": message
    }
    print("Result: " + json.dumps(result, indent=2))
    return result

# The main program starts here.  If started from a command line, run the lambda function manually.
if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") is None:
    event0 = {
      "channel_name": "g88a",
      "user_name": "lupyuen",
      "text": "led+flash1"
    }
    # Start the lambda function.
    lambda_handler(event0, {})