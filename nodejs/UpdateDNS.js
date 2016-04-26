//  This function updates the AWS DNS with the local IP address of a machine.
//  Useful for locating a Raspberry Pi in a large network like TP.
//  Called by https://github.com/lupyuen/RaspberryPiImage/blob/master/home/pi/DNS/update_dns.sh

'use strict';
console.log('Loading function');

let AWS = require('aws-sdk');
let route53 = new AWS.Route53();

exports.handler = (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const ip = event.ip;
    const hostname = event.hostname + '.tp-iot.com.';
    const params = {
      ChangeBatch: { /* required */
        Changes: [ /* required */
          {
            Action: 'UPSERT', /* required */
            ResourceRecordSet: { /* required */
              Name: hostname, /* required */
              Type: 'A', /* required */
              ResourceRecords: [
                {
                  Value: ip
                },
              ],
              TTL: 60,
            }
          }
        ],
        Comment: JSON.stringify(event).substr(0, 220)
      },
      HostedZoneId: 'Z2ZUGCEJOR6L9D'
    };
    
    return route53.changeResourceRecordSets(params, function(err, data) {
      if (err) { 
        console.log(err, err.stack); // an error occurred
        return callback(err);
      }
      console.log(data);           // successful response
      return callback(null, 'OK');
    });

};
