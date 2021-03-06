//  AWS Lambda function to process the SIGFOX message passed by UnaBiz Emulator or UnaCloud,
//  by calling AWS API UpdateThingShadow to update the device state.
//  Node.js 4.3 / index.handler / lambda_iot / 512 MB / 1 min / No VPC

//  Should expose the lambda through AWS API Gateway as follows:
//  Go to AWS API Gateway --> Create API --> New API
//  API Name: SIGFOX
//  Go to AWS Lambda --> ProcessSIGFOXMessage --> Triggers --> Add Trigger --> API Gateway
//  API Name: SIGFOX
//  Deployment Stage: prod
//  Security: Open
//  Go to AWS API Gateway --> SIGFOX --> Actions --> Deploy API --> prod

//  This lambda function must be run as role lambda_iot.
//  lambda_iot must be attached to policy LambdaExecuteIoTUpdate, defined as:
// {
//   "Version": "2012-10-17",
//   "Statement": [
//   {
//     "Effect": "Allow",
//     "Action": [
//       "logs:CreateLogGroup",
//       "logs:CreateLogStream",
//       "logs:PutLogEvents"
//     ],
//     "Resource": "arn:aws:logs:*:*:*"
//   },
//   {
//     "Effect": "Allow",
//     "Action": [
//       "iot:GetThingShadow",
//       "iot:UpdateThingShadow"
//     ],
//     "Resource": [
//       "*"
//     ]
//   },
//   {
//     "Effect": "Allow",
//     "Action": [
//       "kinesis:GetRecords",
//       "kinesis:GetShardIterator",
//       "kinesis:DescribeStream",
//       "kinesis:ListStreams"
//     ],
//     "Resource": [
//       "*"
//     ]
//   }
// ]
// }

'use strict';

console.log('Loading function');

//  Init the AWS connection.
const AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';
AWS.config.logger = process.stdout;  //  Debug

if (!process.env.LAMBDA_TASK_ROOT) {
  //  For unit test, set the credentials.
  const config = require('os').platform() === 'win32' ?
    require('../../../unabiz-emulator/config.json') :
    require('../../../../SIGFOX/unabiz-emulator/config.json');
  AWS.config.credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
}
//  Use AWS command line "aws iot describe-endpoint" to get the endpoint address.
const endpoint = 'A1P01IYM2DOZA0.iot.us-west-2.amazonaws.com';
//  Open the AWS IoT connection with the endpoint.
const iotdata = new AWS.IotData({ endpoint });

exports.handler = (input2, context2, callback2) => {
  /* eslint-disable no-param-reassign, no-restricted-syntax, guard-for-in */
  //  This is the main program flow.
  try {
      //  Input must contain "device" (thing name e.g. g88pi) and "data", the encoded fields.
      let input = input2;
      if (input.domain) delete input.domain;  //  TODO: Contains self-reference loop.
      console.log('ProcessSIGFOXMessage Input:', JSON.stringify(input, null, 2));
      console.log('ProcessSIGFOXMessage Context:', context2);
    
      //  For API Gateway, message is in the field "body".
      if (input.body) input = JSON.parse(input.body);
      
      //  Skip the duplicate message
      if (input.duplicate === 'true' || input.duplicate === true) {
          console.log('Skipping duplicate');
          return callback2(null, lambdaProxyFormat(200, input));
      }
      
      //  Decode the message.
      const decoded_data = decodeMessage(input.data);
      for (const key in input) {
        //  Copy the original input fields into the decoded fields.
        decoded_data[key] = input[key];
      }
      
      //  If "hid" is defined, then set the device name to "home1", "home2", etc.
      //  This will support multiple sensors per home.
      if (decoded_data.hid) {
          const hid = decoded_data.hid;
          const oldDevice = input.device;
          //  Route all hid=2 messages to SmartCanteen device.
          if (hid + '' === '2') input.device = 'SmartCanteen';
          //  Else route to home1, home3, home4, ... device.
          else input.device = 'home' + hid;
          console.log('Changed device from ' + oldDevice + ' to ' + input.device);
      }
      
      //  Update the device/thing state.
      return updateDeviceState(input.device, decoded_data)
        .then(result => callback2(null, lambdaProxyFormat(200, result)))
        .catch(err => {
            console.error(err.message);
            callback2(lambdaProxyFormat(500, err.message));
        });
  } catch (err) {
      console.error(err.message);
      callback2(lambdaProxyFormat(500, err.message));
  }
};

function updateDeviceState(device, state) {
  //  Update the device/thing state.  Returns a promise.
  //  Device must be lower case.
  if (device) device = device.toLowerCase();
  const payload = {
    state: {
      reported: state,
    },
  };
  let timestamp = Date.now();
  //  Timestamp is a string in microseconds.  Convert to local time.
  if (payload.state.reported.timestamp) {
    timestamp = parseInt(payload.state.reported.timestamp, 10);
  }
  const localtime = timestamp + (8 * 60 * 60 * 1000);  //  SG time is GMT+8 hours.
  payload.state.reported.timestamp = new Date(localtime).toISOString().replace('Z', '');
  const params = {
    payload: JSON.stringify(payload),
    thingName: device || 'g88pi',
  };
  console.log({ updateThingShadow: params });
  return iotdata.updateThingShadow(params).promise();
}

//  Decode the structured message sent by unabiz-arduino library.

const firstLetter = 1;  //  Letters are assigned codes 1 to 26, for A to Z
const firstDigit = 27;  //  Digits are assigned codes 27 to 36, for 0 to 9

function decodeLetter(code) {
  //  Convert the 5-bit code to a letter.
  if (code === 0) return 0;
  if (code >= firstLetter && code < firstDigit) return (code - firstLetter) + 'a'.charCodeAt(0);
  if (code >= firstDigit) return (code - firstDigit) + '0'.charCodeAt(0);
  return 0;
}

function decodeText(encodedText0) { /* eslint-disable no-bitwise, operator-assignment */
  //  Decode a text string with packed 5-bit letters.
  let encodedText = encodedText0;
  const text = [0, 0, 0];
  for (let j = 0; j < 3; j = j + 1) {
    const code = encodedText & 31;
    const ch = decodeLetter(code);
    if (ch > 0) text[2 - j] = ch;
    encodedText = encodedText >> 5;
  }
  //  Look for the terminating null and decode name with 1, 2 or 3 letters.
  //  Skip invalid chars.
  return [
    (text[0] >= 48 && text[0] <= 122) ? String.fromCharCode(text[0]) : '',
    (text[1] >= 48 && text[1] <= 122) ? String.fromCharCode(text[1]) : '',
    (text[2] >= 48 && text[2] <= 122) ? String.fromCharCode(text[2]) : '',
  ].join('');
} /* eslint-enable no-bitwise, operator-assignment */

function decodeMessage(data, textFields) { /* eslint-disable no-bitwise, operator-assignment */
  //  Decode the packed binary SIGFOX message body data e.g. 920e5a00b051680194597b00
  //  2 bytes name, 2 bytes float * 10, 2 bytes name, 2 bytes float * 10, ...
  //  Returns an object with the decoded data e.g. {ctr: 999, lig: 754, tmp: 23}
  //  If the message contains text fields, provide the field names in textFields as an array,
  //  e.g. ['d1', 'd2, 'd3'].
  if (!data) return {};
  //  Messages must be either 8, 16 or 24 chars (4, 8 or 12 bytes).
  if (data.length !== 8 && data.length !== 16 && data.length !== 24) return {};
  try {
    const result = {};
    for (let i = 0; i < data.length; i = i + 8) {
      const name = data.substring(i, i + 4);
      const val = data.substring(i + 4, i + 8);
      const encodedName =
        (parseInt(name[2], 16) << 12) +
        (parseInt(name[3], 16) << 8) +
        (parseInt(name[0], 16) << 4) +
        parseInt(name[1], 16);
      const encodedVal =
        (parseInt(val[2], 16) << 12) +
        (parseInt(val[3], 16) << 8) +
        (parseInt(val[0], 16) << 4) +
        parseInt(val[1], 16);

      //  Decode name.
      const decodedName = decodeText(encodedName);
      if (textFields && textFields.indexOf(decodedName) >= 0) {
        //  Decode the text field.
        result[decodedName] = decodeText(encodedVal);
      } else {
        //  Decode the number.
        result[decodedName] = encodedVal / 10.0;
      }
    }
    return result;
  } catch (error) {
    throw error;
  }
} /* eslint-enable no-bitwise, operator-assignment */

function lambdaProxyFormat(statusCode, msg) {
  //  Format the message as lambda proxy for returning results.
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  };
}

//  Unit test cases that will be run on a local PC/Mac instead of AWS Lambda.

function isProduction() {
  //  Return true if this is production server.
  if (process.env.LAMBDA_TASK_ROOT) return true;
  const environment = process.env.NODE_ENV || 'development';
  return environment !== 'development';
}

/* eslint-disable no-unused-vars, quotes, quote-props, max-len, comma-dangle, no-console */

const test_input = {
  "device": "g88pi",
  "data": "920e5a00b051680194597b00"
};

const test_input2 = {  //  API Gateway called by Virtual SIGFOX.
  "resource": "/ProcessSIGFOXMessage",
  "path": "/ProcessSIGFOXMessage",
  "httpMethod": "POST",
  "headers": {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.8,en-GB;q=0.6,zh-CN;q=0.4,zh;q=0.2",
    "Cache-Control": "no-cache",
    "CloudFront-Forwarded-Proto": "https",
    "CloudFront-Is-Desktop-Viewer": "true",
    "CloudFront-Is-Mobile-Viewer": "false",
    "CloudFront-Is-SmartTV-Viewer": "false",
    "CloudFront-Is-Tablet-Viewer": "false",
    "CloudFront-Viewer-Country": "SG",
    "Content-Type": "application/json",
    "Host": "l0043j2svc.execute-api.us-west-2.amazonaws.com",
    "Origin": "chrome-extension://fhbjgbiflinjbdggehcddcbncdddomop",
    "Postman-Token": "efc84281-d0fe-493f-5d55-cb6add7ff043",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.98 Safari/537.36",
    "Via": "1.1 af70784b6b43d4801d09b1c1699dc86a.cloudfront.net (CloudFront)",
    "X-Amz-Cf-Id": "yN5SP6MzZB7JGA49hn_SEAabSveBak6A27DrKbLObOpfQdq2uEHplQ==",
    "X-Forwarded-For": "118.200.15.117, 54.240.148.203",
    "X-Forwarded-Port": "443",
    "X-Forwarded-Proto": "https"
  },
  "queryStringParameters": null,
  "pathParameters": null,
  "stageVariables": null,
  "requestContext": {
    "accountId": "595779189490",
    "resourceId": "s3459w",
    "stage": "prod",
    "requestId": "6fe74419-aef0-11e6-b457-9be7dd0b506b",
    "identity": {
      "cognitoIdentityPoolId": null,
      "accountId": null,
      "cognitoIdentityId": null,
      "caller": null,
      "apiKey": null,
      "sourceIp": "118.200.15.117",
      "accessKey": null,
      "cognitoAuthenticationType": null,
      "cognitoAuthenticationProvider": null,
      "userArn": null,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.98 Safari/537.36",
      "user": null
    },
    "resourcePath": "/ProcessSIGFOXMessage",
    "httpMethod": "POST",
    "apiId": "l0043j2svc"
  },
  "body": "{\n  \"device\": \"g88pi\",\n  \"data\": \"920e5a00b051680194597b00\"\n}",
  "isBase64Encoded": false
};

const test_input3 = {  //  API Gateway called by UnaCloud.
  "resource": "/ProcessSIGFOXMessage",
  "path": "/ProcessSIGFOXMessage",
  "httpMethod": "POST",
  "headers": {
    "CloudFront-Forwarded-Proto": "https",
    "CloudFront-Is-Desktop-Viewer": "true",
    "CloudFront-Is-Mobile-Viewer": "false",
    "CloudFront-Is-SmartTV-Viewer": "false",
    "CloudFront-Is-Tablet-Viewer": "false",
    "CloudFront-Viewer-Country": "SG",
    "Content-Type": "application/json",
    "Host": "l0043j2svc.execute-api.us-west-2.amazonaws.com",
    "Via": "1.1 2c87bd533a7f50a11c5be2c69aaef856.cloudfront.net (CloudFront)",
    "X-Amz-Cf-Id": "aB9VTHO01pvJWFOfAC93ZzCEe9YcMjoVqfQSPLDtYM6kvgWuWgj5cQ==",
    "X-Forwarded-For": "52.163.211.144, 54.240.148.105",
    "X-Forwarded-Port": "443",
    "X-Forwarded-Proto": "https"
  },
  "queryStringParameters": null,
  "pathParameters": null,
  "stageVariables": null,
  "requestContext": {
    "accountId": "595779189490",
    "resourceId": "s3459w",
    "stage": "prod",
    "requestId": "f9d91cd7-b24d-11e6-85b2-0994fdbb92c2",
    "identity": {
      "cognitoIdentityPoolId": null,
      "accountId": null,
      "cognitoIdentityId": null,
      "caller": null,
      "apiKey": null,
      "sourceIp": "52.163.211.144",
      "accessKey": null,
      "cognitoAuthenticationType": null,
      "cognitoAuthenticationProvider": null,
      "userArn": null,
      "userAgent": null,
      "user": null
    },
    "resourcePath": "/ProcessSIGFOXMessage",
    "httpMethod": "POST",
    "apiId": "l0043j2svc"
  },
  "body": "{\"device\":\"1C864E\",\"data\":\"920e14002731f21cb0514a01\",\"duplicate\":false,\"snr\":12.14,\"station\":\"0466\",\"avgSnr\":13.35,\"lat\":1,\"lng\":104,\"rssi\":-66,\"seqNumber\":285,\"ack\":false,\"longPolling\":false,\"timestamp\":\"1479995863000\",\"baseStationTime\":1479995863,\"baseStationLat\":1.314,\"baseStationLng\":103.867}",
  "isBase64Encoded": false
};

const test_context = {
  "awsRequestId": "98dc0220-0eba-11e6-b84a-f75570995fc5",
  "invokeid": "98dc0220-0eba-11e6-b84a-f75570995fc5",
  "logGroupName": "/aws/lambda/SendSensorDataToElasticsearch2",
  "logStreamName": "2016/04/30/[$LATEST]3f3acb23c5294fbcad74c08097c0b03e",
  "functionName": "SendSensorDataToElasticsearch2",
  "memoryLimitInMB": "128",
  "functionVersion": "$LATEST",
  "invokedFunctionArn": "arn:aws:lambda:us-west-2:595779189490:function:SendSensorDataToElasticsearch2"
};

//  Run the unit test if we are in development environment.
function runTest() { /* eslint-disable no-debugger */
  return exports.handler(test_input3, test_context, (err, result) => {
    if (err) { console.error(err); debugger; }
    console.log(result);
    process.exit(0);
  });
}

if (!isProduction()) runTest();
