Define the following rules in Sumo Logic --> Manage --> Field Extractions:

0. Rule Name: `Extract JSON fields from sensor data logs`
   Scope: `_sourceCategory=sensor`
   Parse Expression: See `Extract sensor data.txt`

0. Rule Name: `Extract JSON fields from  AWS IoT logs`
   Scope: `_sourceCategory=aws`
   Parse Expression: See `Extract AWS IoT logs.txt`

0. Rule Name: `Extract syslog fields from Raspberry Pi Linux logs`
   Scope: `_sourceCategory=pi`
   Parse Expression: See `Extract syslog fields.txt`

### For Temasek Poly Sensit Project

0. Rule Name: `Extract JSON fields from tpsensit`
   Scope: `_sourceCategory=tpsensit`
   Parse Expression: See `Extract JSON fields from tpsensit.txt`
