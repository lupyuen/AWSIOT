# This lambda function is called by Slack via AWS API Gateway when the user
# types a message into the channel for a device (e.g. channel #g88).

import json
import boto3

print('Loading function')


def lambda_handler(event, context):
    print("Received event: " + json.dumps(event, indent=2))
    
    # Don't respond to a message that this function has posted previously,
    # because we will be stuck in a loop.
    if event.get("user_name") == "slackbot":
        print("Ignoring my own message")
        return {}
    
    # We will receive a command that looks like "led+flash1". Split the command.
    userCommand = event.get("text")
    userCommandSplit = userCommand.split("+")
    if len(userCommandSplit) != 2:
        print("Bad command")
        return { "text": "Sorry I don't understand your command. " + \
            "Please enter a valid command like 'led flash1'." }
    
    # Compose the desired state that we will send to SetDesiredState via Kinesis.
    desiredState = {
        "device": "g88-pi",
        "attribute": userCommandSplit[0],  # e.g. led
        "value": userCommandSplit[1]  # e.g. flash1
    }
    
    # Send the desired state to Kinesis.
    partitionKey = desiredState["device"]
    kinesisClient = boto3.client('kinesis')
    kinesisResponse = kinesisClient.put_record(
        StreamName='SetDesiredStateStream',
        Data=json.dumps(desiredState),
        PartitionKey=partitionKey)
    print("Kinesis response: " + json.dumps(kinesisResponse, indent=2))

    # Compose the response to be displayed in Slack.
    result = {
        "username": desiredState["device"],
	    "text": ""
    }
    result["text"] = "Setting desired state of " + \
        desiredState["attribute"] + " to " + desiredState["value"] + "..."
    return result
