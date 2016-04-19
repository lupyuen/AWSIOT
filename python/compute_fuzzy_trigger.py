# Version 1.3: Improved Slack format for reported state.
# Version 1.2: If beacon ID not found for value_map_beacon_to_class, set value to "unknown". Skip event if fields are missing.
# Version 1.1: Send message to Slack when setting desired state.
#
# ComputeFuzzyTrigger is a lambda function meant to be invoked by a rule. It captures the previous sensor values,
# and if the cumulative conditions are met, the function will trigger a reported state update (that may
# be used to trigger another rule). The condition includes fuzzy matching, e.g.
# if distance sensor reports < 4 metres for past 1 min for over 80% of readings then ...
#
# Expected inputs for this function:
#    device: Device ID, e.g. "g88_pi".  Usually set to "topic(3)".
#    attribute: State.reported attribute that was just modified, e.g. "temperature".
#    value: Value of the modified attribute.
#    trigger_name: Name of state.reported attribute to be created when conditions are met.
#    trigger_attribute: Attribute to be checked.
#    trigger_value: (Optional) Trigger when value is equal to trigger_equal
#    trigger_upper_limit: (Optional) Trigger when value exceeds trigger_upper_limit
#    trigger_lower_limit: (Optional) Trigger when value drops below trigger_lower_limit
#    trigger_certainty: Certainty factor for checking trigger. For example if certainty factory = 0.8,
#                       then we trigger if 80% of values is equal to trigger values or exceed trigger limits.
#    trigger_period: Check certainty over this past time period, in seconds
#    value_map_beacon_to_class: (Optional) Trigger value is obtained by mapping beacon to class.
# You may specify one or more of trigger_value, trigger_upper_limit and trigger_lower_limit.
#
# For example, say you want to check whether a parking lot is occupied, using an ultrasonic
# distance sensor.  You want to trigger the event "state.reported.lot_is_occupied" if the
# reported distance is under 4 metres for 80% of distance readings over the past 60 seconds.
# You would use pass the following parameters to ComputeFuzzyTrigger:
#    "device": <Your device ID>,
#    "attribute": "distance",
#    "value": <The current distance>,
#    "trigger_name": "lot_is_occupied",
#    "trigger_attribute": "distance",
#    "trigger_lower_limit": 4,
#    "trigger_period": 60,
#    "trigger_certainty": 0.8
#
# To pass the above parameters to ComputeFuzzyTrigger, you could write an AWS IoT rule like:
#     SELECT topic(3) as device,
#            'distance' as attribute,
#            state.reported.distance as value,
#            'lot_is_occupied' as trigger_name,
#            'distance' as trigger_attribute,
#            4 as trigger_lower_limit,
#            60 as trigger_period,
#            0.8 as trigger_certainty
#    FROM '$aws/things/g88_pi/shadow/update/accepted'
#    ACTION: Call lambda function ComputeFuzzyTrigger
#
# Then you could write another rule that is triggered when the parking lot is deemed occupied (according to the above rule):
#    SELECT ...
#    FROM '$aws/things/g88_pi/shadow/update/accepted'
#    WHERE state.reported.lot_is_occupied > 0.8
#    ACTION: ...
#
# For troubleshooting: ComputeFuzzyTrigger stores the past sensor values and statuses in the AWS S3 storage.
# You can view the files through these links:
#   Past sensor values are stored in:
#       https://s3-us-west-2.amazonaws.com/tp-iot/<DEVICEID>_events.json
#       e.g. https://s3-us-west-2.amazonaws.com/tp-iot/g88_pi_events.json
#   The result of the previous 20 calls to ComputeFuzzyTrigger are stored in:
#       https://s3-us-west-2.amazonaws.com/tp-iot/<DEVICEID>_<TRIGGERNAME>_status.json
#       e.g. https://s3-us-west-2.amazonaws.com/tp-iot/g88_pi_lot_is_occupied_status.json
#
# Status looks like:
#   "Waiting for more events until trigger_period is reached for trigger lot_is_occupied. Certainty = 0 / 1 = 0.0"

from __future__ import print_function
import boto3, json, ast, datetime, sys, os, hashlib, hmac, urllib2, base64, pickle
print('Loading function')

# Maps beacon ID to entitlement class.
beacon_to_class = {
    'a123': 'A',
    'a456': 'B',
    'a789': 'C',
    'fda50693a4e24fb1afcfc6eb07647825': '1'
}

# List of device names and the replacement Slack channels for the device.
# Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and
# SendSensorDataToElasticsearch.
replaceSlackChannels = {
    "g88": "g88a",
    "g29": "g29a"
}

# Log on to AWS as lambda_iot_user.
aws_session = boto3.Session(aws_access_key_id='AKIAIAAXOWVF3FX2XBZA',
    aws_secret_access_key='ZF9kDr50UpxotuDvtpITrEP7vjJkwowSEl5szKO0',
    region_name='us-west-2')
# Get AWS S3 client.
s3_client = aws_session.client('s3')


def lambda_handler(event, context):
    print("Received event: " + json.dumps(event, indent=2))
    device = event.get("device")
    attribute = event.get("attribute")
    value = event.get("value")
    timestamp = event.get("timestamp")
    if timestamp is None:
        timestamp = datetime.datetime.now().isoformat()
        event["timestamp"] = timestamp

    trigger_name = event.get("trigger_name")  # Name of trigger to be created when conditions are met.
    trigger_attribute = event.get("trigger_attribute")  # Attribute to be checked.
    trigger_value = event.get("trigger_value")  # Trigger when value is equal to trigger_equal
    trigger_upper_limit = event.get("trigger_upper_limit")  # Trigger when value exceeds trigger_upper_limit
    trigger_lower_limit = event.get("trigger_lower_limit")  # Trigger when value drops below trigger_lower_limit
    trigger_certainty = event.get("trigger_certainty")  # Include certainty factor. If certainty factory = 0.8, then we trigger if 80% of values exceed trigger limits.
    trigger_period = event.get("trigger_period")  # Check certainty over this past time period in seconds

    '''
    occupied_state = {
        "last_occupied": "yyyymmddhhssmm",
        "last_unoccupied": "yyyymmddhhssmm",
        "current_state": "occupied" / "unoccupied"
    }

    occupied_state = retrieve_json("occupied_state.json")
    if state == "unoccupied":
        if occupied_state.current_state == "occupied":
            occupied_state.last_unoccupied = datetime.datetime.now().isoformat()
            duration = 0
        else:
            duration = now - occupied_state.last_unoccupied
    if state == "occupied":
        if occupied_state.current_state == "unoccupied":
            occupied_state.last_occupied = datetime.datetime.now().isoformat()
        else:
            duration = now - occupied_state.last_occupied

    occupied_state.current_state = state
    save_json("occupied_state.json", occuied_state)


    def set_reported_state(device2, attribute2, value2, timestamp2, msg2):
    payload = {
        "state": {
            "reported": {
                "last_occupied": occupied_state.last_occupied,
                "last_unoccupied": occupied_state.last_unoccupied,
                "current_state": occupied_state.current_state,
                "duration": duration,
                attribute2: value2,
                "timestamp": timestamp2
            }
        }
    }
    '''

    value_map_beacon_to_class = event.get("value_map_beacon_to_class")  # Trigger value is obtained by mapping beacon to class.
    if value_map_beacon_to_class is not None:
        # Get the class value from the beacon.
        value = beacon_to_class.get(value_map_beacon_to_class)
        if value is None:
            value = "unknown"
        event["value"] = value
        print("Mapped beacon " + str(value_map_beacon_to_class) + " to value " + str(value))

    # Add the event to the device.
    device_events = retrieve_events(device)
    if device_events is None:
        device_events = [event]
    else:
        device_events = device_events + [event]
    print("device_events length = ", len(device_events))

    # Remove any expired events.
    # TODO: We assume 5 mins expiry for now.
    current_datetime = datetime.datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.%f")
    expiry_datetime = current_datetime - datetime.timedelta(seconds=(5 * 60))
    for e in device_events:
        # Parse the event datetime.
        e_datetime = datetime.datetime.strptime(e["timestamp"], "%Y-%m-%dT%H:%M:%S.%f")
        # If expired, remove from the list.
        if e_datetime < expiry_datetime:
            device_events.remove(e)
    save_events(device, device_events)

    # Count how many times we satisfied the trigger condition.
    # The cutoff time is now - trigger period.
    cutoff_datetime = current_datetime - datetime.timedelta(seconds=trigger_period)
    cutoff_datetime2 = cutoff_datetime - datetime.timedelta(seconds=trigger_period)
    events_tested = 0
    events_satisfied = 0
    period_satisfied = False
    for e in device_events:
        # Skip this event if any field is missing.
        if e.get("timestamp") is None or e.get("attribute") is None or e.get("value") is None:
            continue
        # Parse the event datetime.
        e_datetime = datetime.datetime.strptime(e["timestamp"], "%Y-%m-%dT%H:%M:%S.%f")
        # Event must match our attribute and must be within our past trigger period.
        if e["attribute"] == trigger_attribute:
            if e_datetime < cutoff_datetime2:
                # If a matching attribute has exceeded twice the trigger period, then it's too old, ignore it.
                continue
            elif e_datetime < cutoff_datetime:
                # If a matching attribute has exceeded the trigger period, then we have received enough events to decide.
                period_satisfied = True
            else:
                # This matching attribute is within the trigger period.
                events_tested = events_tested + 1
                # If value conditions are met, count it.
                if trigger_value is not None and e["value"] == trigger_value:
                    events_satisfied = events_satisfied + 1
                elif trigger_upper_limit is not None and e["value"] > trigger_upper_limit:
                    events_satisfied = events_satisfied + 1
                elif trigger_lower_limit is not None and e["value"] < trigger_lower_limit:
                    events_satisfied = events_satisfied + 1

    # Compute the certainty score - how many times the condition was satisfied over the trigger time period.
    certainty = 1.0 * events_satisfied / events_tested
    msg = "Certainty = " + str(events_satisfied) + " / " + str(events_tested) + " = " + str(round(certainty, 1))
    if period_satisfied == False:
        return save_status(event, "Waiting for more events until trigger_period is reached for trigger " + trigger_name + ". " + msg)
    if certainty >= trigger_certainty:
        print("Found sufficient certainty " + str(round(certainty, 1)) + " to start trigger " + trigger_name + ". " + msg)
    else:
        return save_status(event, "Certainty " + str(round(certainty, 1)) + " is not sufficient to start trigger " + trigger_name + ". " + msg)

    # Don't re-trigger within the trigger time period.
    if triggered_recently(device, trigger_name, trigger_period, timestamp):
        return save_status(event, "Trigger " + trigger_name + " was already triggered recently. Try again later. " + msg)

    # Trigger the event by setting the reported state.  Any rules dependent on the reported state will fire.
    set_reported_state(device, trigger_name, certainty, timestamp, msg)
    return save_status(event, "Triggered " + trigger_name + " with certainty " + str(round(certainty, 1)) + ". " + msg)


# Return true if the trigger was triggered within the past trigger time period.
def triggered_recently(device2, trigger_name2, trigger_period2, timestamp2):
    if trigger_period2 < 30:
        trigger_period2 = 30  # Max 1 trigger per 30 seconds.
    # Get the last trigger timestamp from the file.
    filename = device2 + "_" + trigger_name2 + "_trigger.json"
    last_trigger = retrieve_json(filename)
    if last_trigger is not None:
        last_trigger_timestamp = last_trigger["timestamp"]
        current_datetime = datetime.datetime.strptime(timestamp2, "%Y-%m-%dT%H:%M:%S.%f")
        trigger_datetime = datetime.datetime.strptime(last_trigger_timestamp, "%Y-%m-%dT%H:%M:%S.%f")
        if trigger_datetime + datetime.timedelta(seconds=trigger_period2) > current_datetime:
            return True
    save_json(filename, {"timestamp": timestamp2})
    return False


# Save the status of the trigger check to AWS S3 for troubleshooting.
def save_status(event2, msg2):
    device2 = event2["device"]
    trigger2 = event2["trigger_name"]
    status = event2
    status["result"] = msg2
    # Save the last 20 statuses.
    filename = device2 + "_" + trigger2 + "_status.json"
    all_status = retrieve_json(filename)
    if all_status is None:
        all_status = [status]
    else:
        all_status = all_status + [status]
    if len(all_status) > 20:
        all_status = all_status[20:]
    save_json(filename, all_status)
    return msg2


# Save the list of events for the device. Each event includes device, attribute, value, timestamp.
def save_events(device2, events2):
    filename = device2 + "_events.json"
    save_json(filename, events2)


# Retrieve the list of events for the device. Each event includes device, attribute, value, timestamp.
def retrieve_events(device2):
    filename = device2 + "_events.json"
    result = retrieve_json(filename)
    return result


# Update the thing's reported state. This may trigger a rule dependent on the thing's reported state.
def set_reported_state(device2, attribute2, value2, timestamp2, msg2):
    payload = {
        "state": {
            "reported": {
                attribute2: value2,
                "timestamp": timestamp2
            }
        }
    }
    print("Payload: " + json.dumps(payload))
    post_state_to_slack(device2, payload, msg2)
    iot_client = aws_session.client('iot-data')
    response = iot_client.update_thing_shadow(
        thingName=device2,
        payload=json.dumps(payload).encode("utf-8")
    )
    print("update_thing_shadow: ", response)
    if str(response).find("'HTTPStatusCode': 200") > 0:
        slackResult = { "color": "good",
            "title": "Reported state has been set successfully" }
    else:
        slackResult = { "color": "danger",
            "title": "Error: Failed to set reported state" }
    slackResult["fallback"] = slackResult["title"]
    post_to_slack(device2, [ slackResult ])
    return response


# Save a JSON file to AWS S3.
def save_json(filename, json_obj):
    response = s3_client.put_object(Bucket='tp-iot', Key=filename,
        Body=json.dumps(json_obj, indent=2).encode("utf-8"))
    # print("s3.put_object=", response)
    return response


# Retrieve a JSON file from AWS S3. Returns None if not found.
def retrieve_json(filename):
    try:
        response = s3_client.get_object(Bucket='tp-iot', Key=filename)
    except:
        return None
    # print("s3.get_object=", response)
    s = response["Body"].read()
    # print("s=", s)
    result = ast.literal_eval(s)
    return result


def post_state_to_slack(device, state, msg):
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
        "fallback": "Setting " + kind + " state: " + json.dumps(state) + " - " + msg,
        "color": "warning",
        "title": "Setting " + kind + " state",
        "text": ":open_file_folder: _state:_ :open_file_folder: _" + kind + ": - " + msg + "_\n" + \
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
    if replaceSlackChannels.get(channel) is not None:
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
    #print(json.dumps(body, indent=2))
    url = "https://hooks.slack.com/services/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"
    try:
        # Make the REST request to Slack.
        request = urllib2.Request(url, json.dumps(body))
        result2 = urllib2.urlopen(request).read()
        #print("result = " + result2)
        return result2
    except urllib2.HTTPError, error:
        # Show the error.
        error_content = error.read()
        print("error = " + error_content)


    
