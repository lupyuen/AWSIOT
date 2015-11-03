# AWSIOT
Sample Node.js and Python scripts for calling AWS IoT

0. Go to AWS IoT Console, create a Thing named "g0_temperature_sensor".  (Will be renamed to "g88_temperature_sensor".)

0. Add an attribute "temperature" and set the value to 28 (number, not string).

0. Under the newly-created Thing, click "Connect a Device".  Download the *.private.pem.key and *.certificate.pem.crt files, copy to the root folder of the project.

0. Create a rule named "g88_too_hot".  Use this query: SELECT * FROM '$aws/things/+/shadow/update/accepted' WHERE state.reported.temperature > 25

0. Select "SNS" as the action. Create a new topic and subscribe to it.

0. Run this script. It should trigger an SNS email alert.

