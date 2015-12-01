# This lambda function is meant to be invoked by a rule. It captures the previous sensor values,
# and if the conditions are met, the function will trigger a reported state update that may
# trigger another rule. The condition includes fuzzy matching, e.g.
# if distance sensor reports < 4 metres for past 1 min for over 80% of readings then ...
#
# Expected inputs for this function:
#    trigger_name: Name of state.reported attribute to be created when conditions are met.
#    trigger_attribute: Attribute to be checked.
#    trigger_value: (Optional) Trigger when value is equal to trigger_equal
#    trigger_upper_limit: (Optional) Trigger when value exceeds trigger_upper_limit
#    trigger_lower_limit: (Optional) Trigger when value drops below trigger_lower_limit
#    trigger_certainty: Certainty factor for checking trigger. For example if certainty factory = 0.8,
#                       then we trigger if 80% of values is equal to trigger values or exceed trigger limits.
#    trigger_period: Check certainty over this past time period, in seconds
#    value_map_beacon_to_class: (Optional) Trigger value is obtained by mapping beacon to class.

from __future__ import print_function
import boto3, json, ast, datetime
print('Loading function')

# Maps beacon ID to entitlement class.
beacon_to_class = {
    'a123': 'A',
    'a456': 'B',
    'a789': 'C'
}

# Log on to AWS as lambda_iot_user.
aws_session = boto3.Session(aws_access_key_id='AKIAIAAXOWVF3FX2XBZA',
    aws_secret_access_key='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',
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

    value_map_beacon_to_class = event.get("value_map_beacon_to_class")  # Trigger value is obtained by mapping beacon to class.
    if value_map_beacon_to_class is not None:
        # Get the class value from the beacon.
        value = beacon_to_class[value_map_beacon_to_class]
        event["value"] = value

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
        return "Waiting for more events until trigger_period is reached for trigger " + trigger_name + ". " + msg
    if certainty >= trigger_certainty:
        print("Found sufficient certainty " + str(round(certainty, 1)) + " to start trigger " + trigger_name + ". " + msg)
    else:
        return "Certainty " + str(round(certainty, 1)) + " is not sufficient to start trigger " + trigger_name + ". " + msg

    # Don't re-trigger within the trigger time period.
    if triggered_recently(device, trigger_name, trigger_period, timestamp):
        return "Trigger " + trigger_name + " was already triggered recently. Try again later. " + msg

    # Trigger the event by setting the reported state.  Any rules dependent on the reported state will fire.
    set_reported_state(device, trigger_name, certainty, timestamp)
    return "Triggered " + trigger_name + " with certainty " + str(round(certainty, 1)) + ". " + msg


# Return true if the trigger was triggered within the past trigger time period.
def triggered_recently(device2, trigger_name2, trigger_period2, timestamp2):
    if trigger_period2 < 30:
        trigger_period2 = 30  # Max 1 trigger per 30 seconds.
    # Get the last trigger timestamp from the file.
    filename = device2 + "_trigger.json"
    last_trigger = retrieve_json(filename)
    if last_trigger is not None:
        last_trigger_timestamp = last_trigger["timestamp"]
        current_datetime = datetime.datetime.strptime(timestamp2, "%Y-%m-%dT%H:%M:%S.%f")
        trigger_datetime = datetime.datetime.strptime(last_trigger_timestamp, "%Y-%m-%dT%H:%M:%S.%f")
        if trigger_datetime + datetime.timedelta(seconds=trigger_period2) > current_datetime:
            return True
    save_json(filename, {"timestamp": timestamp2})
    return False


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
def set_reported_state(device2, attribute2, value2, timestamp2):
    payload = {
        "state": {
            "reported": {
                attribute2: value2,
                "timestamp": timestamp2
            }
        }
    }
    print("Payload: " + json.dumps(payload))
    iot_client = aws_session.client('iot-data')
    response = iot_client.update_thing_shadow(
        thingName=device2,
        payload=json.dumps(payload).encode("utf-8")
    )
    print("update_thing_shadow: ", response)
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
    
