/*
Record sensor data for all SIGFOX devices defined in config.state.reported.sigfox_devices.
Ensure that iot.amazonaws.com and lambda.amazonaws.com are trusted by role lambda_iot.
topic(3) = device ID e.g. c12345
get_thing_shadow("config","arn:aws:iam::595779189490:role/lambda_iot").state.reported.sigfox_devices
  = list of SIGFOX device IDs, e.g. ["c11111", "c22222"]
*/

SELECT

  indexOf(
    cast(
      (
        get_thing_shadow("config","arn:aws:iam::595779189490:role/lambda_iot")
        .state.reported.sigfox_devices
      )
      as String
    ),
    topic(3)
  )
  as test3,
  *, version, topic() as topic, traceId() as traceId

FROM

  $aws/things/+/shadow/update/documents

WHERE

  indexOf(
    cast(
      (
        get_thing_shadow("config","arn:aws:iam::595779189490:role/lambda_iot")
        .state.reported.sigfox_devices
      )
      as String
    ),
    topic(3)
  )
  >= 0
