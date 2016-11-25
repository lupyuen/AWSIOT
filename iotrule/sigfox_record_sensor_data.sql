/*
Record sensor data for all SIGFOX devices defined in config.state.reported.sigfox_devices.
topic(2) = device ID e.g. c12345
get_thing_shadow("config","arn:aws:iam::595779189490:role/lambda_iot").state.reported.sigfox_devices
  = list of SIGFOX device IDs, e.g. ["c11111", "c22222"]
*/

SELECT
  cast(
    (
      get_thing_shadow("config","arn:aws:iam::595779189490:role/lambda_iot")
      .state.reported.sigfox_devices
    )
    as String
  ) as test,
  *, version, topic() as topic, traceId() as traceId
FROM
  '$aws/things/g88pi/shadow/update/documents'
WHERE
  indexOf(
    cast(
      get_thing_shadow("config","arn:aws:iam::595779189490:role/lambda_iot").state.reported.sigfox_devices
      as String
    ),
    topic(1)
  ) >= 0
