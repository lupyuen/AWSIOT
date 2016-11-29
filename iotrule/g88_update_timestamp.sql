/*
Update the timestamp from the Physical Device g88pi
to the Logical Device g88lamppost.
This will also trigger the processing of rules on
Logical Device g88lamppost.

SQL Version = beta

Action:
Republish messages to an AWS IoT topic

Topic: (note the double "$")
$$aws/things/g88lamppost/shadow/update

IAM Role Name:
lambda_iot
*/

SELECT

  current.state.reported.timestamp as
    state.reported.timestamp

FROM

  $aws/things/g88pi/shadow/update/documents

INTO

  $$aws/things/g88lamppost/shadow/update

