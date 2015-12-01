from __future__ import print_function
import boto3, json, datetime
print('Loading function')

# Maps device name to a list of events recorded for the device: <device, attribute, value, timestamp>.
device_to_events = {}

# Maps device name to the maximum trigger period requested.
device_to_max_trigger_period = {}

# Maps beacon ID to entitlement class.
beacon_to_class = {
    'a123': 'A',
    'a456': 'B',
    'a789': 'C'
}

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
    trigger_period = event.get("trigger_period")  # Check certainty over this past time period.
    
    # Add the event to the device.
    if device_to_events.get(device) is None:
        device_to_events[device] = [event]
    else:
        device_to_events[device] = device_to_events[device] + [event]
    print("device_to_events length = " + str(len(device_to_events)))
    print("device_to_events[device] length = " + str(len(device_to_events[device])))
        
    # Remove any expired events.
    # TODO: We assume 5 mins expiry for now.
    current_datetime = datetime.datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.%f")
    expiry_datetime = current_datetime - datetime.timedelta(seconds=(5 * 60))
    for e in device_to_events[device]:
        # Parse the event datetime.
        e_datetime = datetime.datetime.strptime(e["timestamp"], "%Y-%m-%dT%H:%M:%S.%f")
        # If expired, remove from the list.
        if e_datetime < expiry_datetime:
            device_to_events[device].remove(e)

    # Count how many times we satisfied the trigger condition.
    cutoff_datetime = current_datetime - datetime.timedelta(seconds=trigger_period)
    events_tested = 0
    events_satisfied = 0
    period_satisfied = False
    for e in device_to_events[device]:
        # Parse the event datetime.
        e_datetime = datetime.datetime.strptime(e["timestamp"], "%Y-%m-%dT%H:%M:%S.%f")
        # Event must match our attribute and must be within our past trigger period.
        if e["attribute"] == trigger_attribute:
            if e < cutoff_datetime:
                # If a matching attribute has exceeded the trigger period, then we have received enough events to decide.
                period_satisfied = True
            else:
                events_tested = events_tested + 1
                # Check whether the value conditions are met.
                if trigger_value is not None:
                    if e.value == trigger_value:
                        events_satisfied = events_satisfied + 1
                elif trigger_upper_limit is not None:
                    if e.value > trigger_upper_limit:
                        events_satisfied = events_satisfied + 1
                elif trigger_lower_limit is not None:
                    if e.value < trigger_lower_limit:
                        events_satisfied = events_satisfied + 1
                        
    if period_satisfied == False:
        return "Waiting for more events until trigger_period is reached for trigger " + trigger_name
    certainty = 1.0 * events_satisfied / events_tested
    print("Certainty = " + str(events_satisfied) + " / " + str(events_tested) + " = " + str(certainty))
    if certainty >= trigger_certainty:
        print("Found sufficient certainty " + str(certainty) + " to start trigger " + trigger_name)
    else:
        return "Certainty " + str(certainty) + " is not sufficient to start trigger " + trigger_name

    # Log on to AWS.
    session = boto3.Session(aws_access_key_id='AKIAIAAXOWVF3FX2XBZA',
        aws_secret_access_key='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',
        region_name='us-west-2')
        
    # Update the thing's reported state.
    payload = {
        "state": {
            "reported": {
                trigger_name: certainty,
                "timestamp": timestamp
            }
        }
    }
    print("Payload: " + json.dumps(payload))
    client = session.client('iot-data')
    response = client.update_thing_shadow(
        thingName=device,
        payload=json.dumps(payload).encode("utf-8")
    )
    return "Triggered " + trigger_name + " with certainty " + str(certainty)
    #raise Exception('Something went wrong')
    