/*
If the light sensor did not detect any light
and the light has been out for 30 seconds or more,
send an SMS alert.

Note that the time difference computation
doesn't cater for rollover at midnight.

SQL Version = beta

Action:
Run Lambda Function SendSMS

IAM Role Name:
lambda_iot

*/

SELECT

  '+6587177328'
    as phone,
  'g88lamppost light is faulty'
    as message

FROM

  $aws/things/g88lamppost/shadow/update/documents

WHERE

  current.state.reported.light_detected = false AND
  (
    cast(substring(current.state.reported.timestamp, 11, 13) as int) * 60 * 60 +
    cast(substring(current.state.reported.timestamp, 14, 16) as int) * 60 +
    cast(substring(current.state.reported.timestamp, 17, 19) as int)
  ) -
  (
    cast(substring(current.state.reported.light_off_timestamp, 11, 13) as int) * 60 * 60 +
    cast(substring(current.state.reported.light_off_timestamp, 14, 16) as int) * 60 +
    cast(substring(current.state.reported.light_off_timestamp, 17, 19) as int)
  ) >= 30

