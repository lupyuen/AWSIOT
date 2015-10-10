#!/bin/bash

##  Set the AWS credentials and run the unit test.
## . "/credentials.sh"
cd "/Users/Luppy/Temasek Poly/IoT/AWSIOT/"
PATH=$PATH:/usr/local/bin
##./upload.bash &
mocha

##  Kill the SSH tunnel for Redis.
#echo "Killing SSH tunnel for Redis..."
#pkill -l -f "ssh -N -L 6379:"
