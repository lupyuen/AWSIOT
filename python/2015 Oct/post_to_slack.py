#!/usr/bin/env python

# Post a message to Slack.

import urllib2, json

# List of device names and the replacement channels for the device.
# Used if the channel name is already taken up.
replaceSlackChannels = {
    "g88": "g88a"
}


def postToSlack(device, action):
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
        "username": device,
        "text": action
    }
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

postToSlack("g88_pi", "Testing 1 2 3")
