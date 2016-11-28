/*
If the light sensor detects a transition
from bright to dark, set the "light_detected"
status of Logical Device g88lamppost to false,
and set "light_off_timestamp" to the current timestamp.

SQL Version = beta

Action:
Republish messages to an AWS IoT topic

Topic: (note the double "$")
$$aws/things/g88lamppost/shadow/update

IAM Role Name:
lambda_iot

*/

SELECT

  false as
    state.reported.light_detected,

  current.state.reported.timestamp as
    state.reported.light_off_timestamp

FROM

  $aws/things/g88pi/shadow/update/documents

WHERE

  current.state.reported.lig < 500 AND
  previous.state.reported.lig >= 500
