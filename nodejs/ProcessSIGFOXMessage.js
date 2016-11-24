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
  const config = require('../../../../SIGFOX/unabiz-emulator/config.json');
  AWS.config.credentials.accessKeyId = config.accessKeyId;
  AWS.config.credentials.secretAccessKey = config.secretAccessKey;
}
//  Use AWS command line "aws iot describe-endpoint" to get the endpoint address.
const endpoint = 'A1P01IYM2DOZA0.iot.us-west-2.amazonaws.com';
//  Open the AWS IoT connection with the endpoint.
const iotdata = new AWS.IotData({ endpoint });

exports.handler = (input2, context2, callback2) => {
  /* eslint-disable no-param-reassign, no-restricted-syntax, guard-for-in */
  //  This is the main program flow.
  //  Input must contain "device" (thing name e.g. g88pi) and "data", the encoded fields.
  let input = input2;
  if (input.domain) delete input.domain;  //  TODO: Contains self-reference loop.
  console.log('ProcessSIGFOXMessage Input:', JSON.stringify(input, null, 2));
  console.log('ProcessSIGFOXMessage Context:', context2);

  //  For API Gateway, message is in the field "body".
  if (input.body) input = JSON.parse(input.body);
  //  Decode the message.
  const decoded_data = decodeMessage(input.data);
  for (const key in input) {
    //  Copy the original input fields into the decoded fields.
    decoded_data[key] = input[key];
  }
  //  Update the device/thing state.
  return updateDeviceState(input.device, decoded_data)
    .then(result => callback2(null, lambdaProxyFormat(200, result)))
    .catch(err => callback2(lambdaProxyFormat(500, err)));
};

function updateDeviceState(device, state) {
  //  Update the device/thing state.  Returns a promise.
  //  Device must be lower case.
  device = device.toLowerCase();
  const payload = {
    state: {
      reported: state,
    },
  };
  if (!payload.state.reported.timestamp) {
    const localtime = Date.now() + (8 * 60 * 60 * 1000);  //  SG time is GMT+8 hours.
    payload.state.reported.timestamp = new Date(localtime).toISOString().replace('Z', '');
  }
  const params = {
    payload: JSON.stringify(payload),
    thingName: device || 'g88pi',
  };
  console.log({ updateThingShadow: params });
  return iotdata.updateThingShadow(params).promise();
}

function decodeMessage(msg) { /* eslint-disable no-bitwise, operator-assignment */
  //  Decode the packed binary SIGFOX message e.g. 920e5a00b051680194597b00
  //  2 bytes name, 2 bytes float * 10, 2 bytes name, 2 bytes float * 10, ...
  if (!msg) return {};
  const result = {};
  for (let i = 0; i < msg.length; i = i + 8) {
    const name = msg.substring(i, i + 4);
    const val = msg.substring(i + 4, i + 8);
    let name2 =
      (parseInt(name[2], 16) << 12) +
      (parseInt(name[3], 16) << 8) +
      (parseInt(name[0], 16) << 4) +
      parseInt(name[1], 16);
    const val2 =
      (parseInt(val[2], 16) << 12) +
      (parseInt(val[3], 16) << 8) +
      (parseInt(val[0], 16) << 4) +
      parseInt(val[1], 16);

    //  Decode name.
    const name3 = [0, 0, 0];
    for (let j = 0; j < 3; j = j + 1) {
      const code = name2 & 31;
      const ch = decodeLetter(code);
      if (ch > 0) name3[2 - j] = ch;
      name2 = name2 >> 5;
    }
    const name4 = String.fromCharCode(name3[0], name3[1], name3[2]);
    result[name4] = val2 / 10.0;
  }
  return result;
}

const firstLetter = 1;
const firstDigit = 27;

function decodeLetter(code) {
  //  Convert the 5-bit code to a letter.
  if (code === 0) return 0;
  if (code >= firstLetter && code < firstDigit) return (code - firstLetter) + 'a'.charCodeAt(0);
  if (code >= firstDigit) return (code - firstDigit) + '0'.charCodeAt(0);
  return 0;
}

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

const test_input2 = {  //  API Gateway
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
  return exports.handler(test_input2, test_context, (err, result) => {
    if (err) { console.error(err); debugger; }
    console.log(result);
    process.exit(0);
  });
}

if (!isProduction()) runTest();
