'use strict';

//  Send IoT sensor data and AWS IoT Logs to Sumo Logic and Slack for searching and dashboards
//  Node.js 4.3 / index.handler / lambda_basic_execution / 512 MB / 1 min / No VPC
//  This AWS Lambda function accepts a JSON input of sensor values and sends them to Sumo Logic
//  search engine for indexing.  It also sends to AWS CloudWatch and posts a message to Slack.  The input looks like:
//  {"temperature":84,"timestampText":"2015-10-11T09:18:51.604Z","version":139,
//  "xTopic":"$aws/things/g88pi/shadow/update/accepted","xClientToken":"myAwsClientId-0"}

//  To configure this lambda as CloudWatch Subscription Filter:
//  Click CloudWatch --> Logs
//  Click checkbox for AWSIoTLogs
//  Click Actions --> Stream to AWS Lambda
//  Select "IndexAWSLogs"
//  Select Log Format = Other, set Subscription Filter Pattern to blank

//  Make sure the role executing this Lambda function has CloudWatch PutMetricData and PutMetricAlarm permissions.
//  Attach the following policy SendCloudWatchData to role lambda_basic_execution:
/*
 {
 "Version": "2012-10-17",
 "Statement": [
 {
 "Sid": "SendCloudWatchData",
 "Resource": "*",
 "Action": [
 "cloudwatch:PutMetricData",
 "cloudwatch:PutMetricAlarm"
 ],
 "Effect": "Allow"
 }
 ]
 }
 */

console.log('Loading function');

//  List of device names and the replacement Slack channels for the device.
//  Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and SetDesiredState.
const replaceSlackChannels = {
  'g88': 'g88a'
};

const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

//  Init the AWS connection.
let AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';
//AWS.config.logger = process.stdout;  //  Debug
let cloudwatch = new AWS.CloudWatch();

//  This lambda uses autorequire to install any missing require(...) modules
//  automatically.  This is useful for AWS Lambda because otherwise we need to
//  upload all the modules as a zipped package and we lose the inline editing capability.
let autorequire = null;

const main = (event, context, callback) => {
  //  This is the main execution scope.  All non-system require(...)
  //  statements must be put here.

  //  This missing module is normally not allowed for inline lambda.  But
  //  autorequire will install the module automatically for us.
  const mysql = require('mysql2/promise');

  function handler(input, context, callback) {
    //  This is the main program flow after resolving the missing modules.
    if (input.domain) delete input.domain;  ////  TODO
    console.log('IndexSensorData Input:', input);
    console.log('IndexSensorData Context:', context);

    //  Index the sensor data.
    //  Don't index response to set desired state.
    if (input.state && input.state.desired) return callback(null, 'Ignoring response to set desired state');
    //  This Sumo Logic Collector URL is unique to us: Sensor Data Logs
    const url = 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/ZaVnC4dhaV2spqT2JdXJBek02aporY-ujTTn2eTcc3XfNomF_U94P6-YIpFZ6FIyAJqG9rNtzNK0JmP13upzBiH8FUfaSMyQmXqgfMdfSGazF6czrBHHxw==';
    const ret = processSensorData(input, context);
    const device = ret.device;
    const actionCount = ret.actionCount;
    const awslogsData = ret.awslogsData;
    //  Process the logs, write to MySQL and Sumo Logic.
    return processLogs(url, device, awslogsData)
    //  If no errors, return the result to AWS.
      .then((res) => callback(null, res))
      //  Or return the error to AWS.
      .catch((err) => callback(err));
  }

  function processLogs(url, tags, awslogsData) {
    //  Transform the input to JSON messages for indexing, then write to MySQL and Sumo Logic.
    //  Returns a promise.
    let records = transformLog(awslogsData);
    //  Skip control messages.
    if (!records) return Promise.resolve('Received a control message');

    //  Write JSON messages to MySQL.
    const promises = [];
    for (const record of records) {
      const promise = writeDatabase(record.extractedFields, context);
      promises.push(promise);
    }

    //  Post JSON messages to Sumo Logic.
    const promise = postLogsToSumoLogic(url, records, tags);
    promises.push(promise);

    //  We have accumulated a list of MySQL and SumoLogic updates.  Wait for all of them.
    return Promise.all(promises);
  }

  function writeDatabase(event, context) {
    //  Write the record to MySQL database.  Returns a promise.
    console.log({event});
    const table = 'g88_sensor_data';  //  TODO
    //  Connect to the MySQL database.
    return mysql.createConnection({
      host     : 'iotdb.culga9y9tfvw.us-west-2.rds.amazonaws.com',
      user     : 'root',
      password : 'iotattp4me',
      database : 'iotdb'
    })
      .then(conn => {
        const timestamp = new Date();
        const promises = [];
        //  Insert each sensor value in a separate MySQL row.
        for (const key in event) {
          const val = event[key];
          const row = { timestamp, sensor: key };
          //  Write numbers into 'number' field and strings into 'text' field.
          if (typeof val === number) row.number = val;
          else if (typeof val === string) row.text = val;
          else row.text = JSON.stringify(val);  //  Everything else write as JSON.
          console.log(`Writing key ${key}=${val}, ${JSON.stringify(row)}`);

          //  Accumulate each promise and wait for all promises.
          const promise = conn.query('insert into ?? set ?', [table, row]);
          promises.push(promise);
        }
        //  Wait for all queries to complete.
        return Promise.all(promises);
      })
      .catch(err => {
        console.error({handler: err});
        throw err;
      });
  }

  let default_device = 'Unknown';

  function getDevice(input) {
    //  Get the device name.
    if (input.device)
      return input.device;
    let device = default_device;
    let topic = null;
    if (input.topic) topic = input.topic;
    else if (input.input && input.input.topic) topic = input.input.topic;
    if (topic) {
      //  We split the topic to get the device name.  The topic looks like "$aws/things/g88pi/shadow/update/accepted"
      let topicArray = topic.split('/');
      if (topicArray.length >= 3) {
        device = topicArray[2];
        console.log(`device=${device}`);
      }
    }
    //  If this is a Slack message, get the device name from the channel.
    //  Use the same device name for the rest of the log file.
    if (device == 'Unknown' && input.channel_name) {
      default_device = mapChannelToDevice(input.channel_name);
      device = default_device;
    }
    return device;
  }

  function mapChannelToDevice(channel) {
    //  Map the Slack channel to device name.  e.g. g88a will return g88pi
    for (let key in replaceSlackChannels) {
      if (replaceSlackChannels[key] == channel)
        return key + 'pi';
    }
    return channel + 'pi';
  }

  function processSensorData(input, context) {
    //  Format the sensor data into a Sumo Logic update request.
    //console.log(JSON.stringify({input: input})); ////
    let extractedFields = {};
    let action = '';
    let device = getDevice(input);
    extractedFields.device = device;
    let sensor_data = null;
    //  For AWS IoT 2016-03-23-beta, sensor data is located in the field
    //  "state->reported" or "input->state->reported".  We move them up to top level.
    if (input.state && input.state.reported) {
      sensor_data = JSON.parse(JSON.stringify(input.state.reported));
      delete input.state;
    }
    else if (input.input && input.input.state && input.input.state.reported) {
      sensor_data = JSON.parse(JSON.stringify(input.input.state.reported));
      delete input.input;
    }
    //  For AWS IoT 2015-10-08, sensor data is located in the field "reported".  We move them up to top level.
    else if (input.reported) {
      sensor_data = JSON.parse(JSON.stringify(input.reported));
      delete input.reported;
    }
    if (sensor_data)
      for (let key in sensor_data)
        input[key] = sensor_data[key];
    if (input.metadata) delete input.metadata;

    //  Copy the keys and values for indexing.
    let actionCount = 0;
    let sensorData = {};
    for (let key in input) {
      let value = input[key];
      extractedFields[key] = value;
      if (action.length > 0)
        action = action + ', ';
      action = action + key + ': ' + value;
      actionCount++;
      //  Don't send non-sensor fields to Slack.
      if (key === 'traceId') continue;
      sensorData[key] = value;
      //  If the value is numeric, send the metric to CloudWatch.
      if (key != 'version' && !isNaN(value))
        try { writeMetricToCloudWatch(device, key, value) }
        catch(err) { console.error(err, err.stack); }
    }
    if (!extractedFields.event) extractedFields.event = 'IndexSensorData';

    let awslogsData = {
      logGroup: device,
      logStream: device,
      logEvents: [{
        id: context.awsRequestId,
        timestamp: 1 * (new Date()),
        message: JSON.stringify(input),
        extractedFields: extractedFields
      }]
    };
    console.log('IndexSensorData awslogsData:', JSON.stringify(awslogsData));
    //  Post a Slack message to the private group of the same name e.g. g88.
    postSensorDataToSlack(device, sensorData);  //  Don't wait for response.
    return {device: device, actionCount: actionCount, awslogsData: awslogsData};
  }

  function transformLog(payload) {
    //  Transform the log into Sumo Logic format.
    if (payload.messageType === 'CONTROL_MESSAGE') return null;
    let bulkRequestBody = '';
    payload.logEvents.forEach(function(logEvent) {
      //  Parse any JSON fields.
      if (!logEvent.extractedFields) {
        logEvent.extractedFields = extractJson(logEvent.message);
        if (logEvent.extractedFields) logEvent.extractedFields = JSON.parse(logEvent.extractedFields);
        else logEvent.extractedFields = {};
      }
      //  Timestamp must be first field or Sumo Logic may pick another field.
      let timestamp = new Date(1 * logEvent.timestamp);
      logEvent.extractedFields.timestamp = timestamp.toISOString();
      //  logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
      //  We extract the fields.
      parseIoTFields(logEvent);
      let source = buildSource(logEvent.message, logEvent.extractedFields);
      //source['id'] = logEvent.id;  //  Ignore ID because it is very long.
      console.log(`transformLog: ${logEvent.message} =>\n${JSON.stringify(source)}`);  ////
      bulkRequestBody += JSON.stringify(source) + '\n';
    });
    return bulkRequestBody;
  }

  function buildSource(message, extractedFields) {
    if (extractedFields) {
      let source = {};
      for (let key in extractedFields) {
        let value = extractedFields[key];
        if (isNumeric(value)) {
          source[key] = 1 * value;
          continue;
        }
        let jsonSubString = extractJson(value);
        if (jsonSubString !== null) {
          source['$' + key] = JSON.parse(jsonSubString);
        }
        source[key] = value;
      }
      return source;
    }
    let jsonSubString2 = extractJson(message);
    if (jsonSubString2 !== null) {
      return JSON.parse(jsonSubString2);
    }
    return {};
  }

  function parseIoTFields(logEvent) {
    // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    // We extract the fields.  Do the same for logevent.extractedFields.event.  Also we remove "TRACEID:", "PRINCIPALID:", "EVENT:" from the existing fields.
    //console.log("parseIoTFields logEvent=", JSON.stringify(logEvent));
    let fields = logEvent.extractedFields;
    //  Parse the message field.
    if (logEvent.message) parseIoTData(fields, logEvent.message);
    if (fields.principal) fields.principal = fields.principal.replace(' [INFO]', '');
    //  Parse the data field.
    if (fields.data) {
      parseIoTData(fields, fields.data);
      delete fields.data;
    }
    //  Parse the event field.
    if (fields.event && fields.event.indexOf(':') > 0) {
      parseIoTData(fields, fields.event);
      delete fields.event;
    }
    if (!fields.device) fields.device = getDevice(fields);
    //  Try to populate the function field for easier viewing as a table.
    switch(fields.event) {
      case 'SNSActionFailure':
        fields.function = fields.target_arn; break;
      case 'MatchingRuleFound':
        fields.function = fields.matching_rule_found; break;
      case 'PublishOut':
      case 'PublishEvent':
        let topic_split = fields.topic.split('/');
        fields.function = topic_split[topic_split.length - 1]; break;
      case 'LambdaActionSuccess':
        fields.status2 = fields.status;
        if (fields.status.startsWith('202'))
          fields.status = 'SUCCESS';
        break;
    }
  }

  function parseIoTData(fields, data) {
    // data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    // We extract the fields and populate into the "fields" collection.
    let pos = 0;
    let lastPos = -1;
    let lastFieldName = null;
    for (;;) {
      let match = matchIoTField(data, pos);
      if (match.pos < 0) break;
      if (lastPos < 0) {
        //  First iteration.
        lastPos = match.pos + 1;
        lastFieldName = match.fieldName;
      }
      else {
        //  Extract from lastPos to match.pos.
        let nameAndValue = data.substring(lastPos, match.pos);
        fields[normaliseFieldName(lastFieldName)] = nameAndValue.substr(
          lastFieldName.length + 1).trim();
        lastPos = match.pos;
        lastFieldName = match.fieldName;
        pos = match.pos + 1;
      }
    }
    //  Extract the last field.
    if (lastPos >= 0) {
      let nameAndValue2 = data.substr(lastPos);
      fields[normaliseFieldName(lastFieldName)] = nameAndValue2.substr(
        lastFieldName.length + 1).trim();
    }
    return '';
  }

  function matchIoTField(data, pos) {
    //  event contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    //  We return the next position on or after pos that matches an IoT field (e.g. "EVENT:"), and return the field name.
    if (pos >= data.length) return { pos: -1, fieldName: '' };
    let matchPos = -1;
    let matchFieldName = null;
    for (const fieldName in fieldNames) {
      let fieldPos = data.toLowerCase().indexOf(fieldName.toLowerCase() + ':', pos);
      if (fieldPos < 0) continue;
      if (matchPos < 0 || fieldPos < matchPos) {
        matchPos = fieldPos;
        //  Rename the field if necessary.
        matchFieldName = fieldName;
      }
    }
    return {
      pos: matchPos,
      fieldName: matchFieldName
    };
  }

  function postLogsToSumoLogic(url, body, tags) {
    //  Post the sensor data logs to Sumo Logic via HTTPS.  Returns a promise.
    //  Change timestamp to Sumo Logic format: "timestamp":"2016-02-08T00:19:14.325Z" -->
    //    "timestamp":"2016-02-08T00:19:14.325+0000"
    body = body.replace(/("timestamp":"[^"]+)Z"/g, '$1+0000"');
    console.log(`postLogsToSumoLogic: body=${body}`);  ////
    const url_split = url.split('/', 4);
    const host = url_split[2];
    const path = url.substr(url.indexOf(host) + host.length);
    let request_params = {
      host: host,
      method: 'POST',
      path: path,
      body: body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Sumo-Name': tags || 'Logger'
      }
    };
    //  Return this as a promise so we can wait for multiple items easily.
    return new Promise((resolve, reject) => {
      let request = https.request(request_params, (response) => {
        let response_body = '';
        response.on('data', (chunk) => {
          response_body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode > 299) {
            console.error(response.body);
            return reject(new Error(response_body));
          }
          return resolve(response_body);
        });
      }).on('error', (e) => {
        console.error(e);
        return reject(e);
      });
      //  Make the request and wait for callback.
      request.end(request_params.body);
    });
  }

  function writeMetricToCloudWatch(device, metric, value) {
    //  Write the sensor data as a metric to CloudWatch.
    console.log('writeMetricToCloudWatch:', device, metric, value);
    try {
      let params = {
        MetricData: [{
          MetricName: metric,
          Timestamp: new Date(),
          Unit: 'None',
          Value: value
        }],
        Namespace: device
      };
      cloudwatch.putMetricData(params, function(err, data) {
        if (err) return console.log('putMetricData error:', err, err.stack); // an error occurred
        console.log('putMetricData: ', data);  // successful response
      });
    }
    catch(err) {
      console.log('Unable to log to CloudWatch', err);
    }
  }

  //  Map group name to the search results for the group (search results -> share):
  //  e.g. g88 -> https://service.us2.sumologic.com/ui/#section/search/w3E1OOZlQuGFikPAy45ejRSyY8Q7KyUenQAMwr8h
  //           -> g88pi AND _sourceCategory=sensor | json auto "device", "temperature", "humidity", "light_level", "sound_level"
  const search_by_group = {
  };

  function postSensorDataToSlack(device, sensorData) {
    //  Post the sensor values to a Slack group for the device e.g. g88.
    //  device is assumed to begin with the group name. sensorData contains
    //  the sensor values.  Returns a promise.
    if (!device) return Promise.resolve(null);
    console.log(JSON.stringify({sensorData: sensorData})); ////

    let channel = '';
    let pos = device.indexOf('_');
    if (pos > 0)
      channel = device.substring(0, pos);
    //http://d3gc5unrxwbvlo.cloudfront.net/_plugin/kibana/#/discover/Sensor-Data?_g=(refreshInterval:(display:'10%20seconds',section:1,value:10000),time:(from:now-1d,mode:quick,to:now))&_a=(query:(query_string:(analyze_wildcard:!t,query:'%%CHANNEL%%*')))'
    let url = search_by_group[device] || 'http://sumologic.com';
    url = url.split('%%CHANNEL%%').join(channel);
    //  Clone a copy.
    let sensorData2 = JSON.parse(JSON.stringify(sensorData));
    //  Combine the less important fields.
    let otherFields = '';
    if (sensorData2.timestampText) {
      otherFields = otherFields + ' - ' + sensorData2.timestampText.substr(0, 19);
      delete sensorData2.timestampText;
    }
    if (sensorData2.topic) {
      otherFields = otherFields + ' - ' + sensorData2.topic;
      delete sensorData2.topic;
    }
    if (sensorData2.version) {
      otherFields = otherFields + ' - ' + sensorData2.version;
      delete sensorData2.version;
    }
    //  Add each field.
    let fields = [];
    for (let key in sensorData2)
      fields.push({ title: key, value: sensorData2[key] + '', short: true });
    if (otherFields.length > 0)
      fields.push({ title: '', value: '_' + otherFields + '_', short: false });
    //  Compose and send the attachment to Slack.
    let attachment = {
      'mrkdwn_in': ['fields'],
      'fallback': JSON.stringify(sensorData),
      'color': '#439FE0',
      //'pretext': 'Optional text that appears above the attachment block',
      //'author_name': 'Bobby Tables',
      //'author_link': 'http://flickr.com/bobby/',
      //'author_icon': 'http://flickr.com/icons/bobby.jpg',
      'title': 'Received sensor data (Click for more...)',
      'title_link': url,
      //'text': 'Optional text that appears within the attachment',
      'fields': fields
      //'image_url': 'http://my-website.com/path/to/image.jpg',
      //'thumb_url': 'http://example.com/path/to/thumb.png'
    };
    return postToSlack(device, [attachment], callback);
  }

  function postToSlack(device, textOrAttachments) {
    //  Post a Slack message to the private group of the same name e.g. g88.
    //  device is assumed to begin with the group name. text is the text
    //  message, attachments is the Slack rich text format.  Returns a promise.
    if (!device) return Promise.resolve(null);
    let channel = device;
    let pos = device.indexOf('_');
    if (pos > 0)
      channel = device.substring(0, pos);
    //  Change g88pi to g88.
    channel = channel.split('pi').join('');
    if (replaceSlackChannels[device])
      channel = replaceSlackChannels[device];
    else if (replaceSlackChannels[channel])
      channel = replaceSlackChannels[channel];
    let body = {
      channel: '#' + channel,
      username: device
    };
    if (textOrAttachments[0] && textOrAttachments[0].length == 1)
      body.text = textOrAttachments;
    else
      body.attachments = textOrAttachments;
    let options = {
      hostname: 'hooks.slack.com',
      path: '/services/T09SXGWKG/B1GR8D13N/D3nlpxoqZmNIKyTzBLM8OPV9',
      method: 'POST'
    };
    console.log('Slack request =', JSON.stringify(body));
    return new Promise((resolve, reject) => {
      let req = https.request(options, res => {
        let body = '';
        //console.log('Status:', res.statusCode);
        //console.log('Headers:', JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          //  If we know it's JSON, parse it
          if (res.headers['content-type'] === 'application/json')
            body = JSON.parse(body);
          console.log('Slack Result', body);
          return resolve(body);
        });
      });
      req.on('error', e => {
        console.error('Slack Error', e, e.stack);
        return reject(e);
      });
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  function extractJson(message) {
    //  If the message contains a JSON string, return the JSON.
    if (typeof message !== 'string') return null;
    let jsonStart = message.indexOf('{');
    if (jsonStart < 0) return null;
    let jsonSubString = message.substring(jsonStart);
    return isValidJson(jsonSubString) ? jsonSubString : null;
  }

  function isValidJson(message) {
    //  Return true if this is a valid JSON string.
    try {
      JSON.parse(message);
    } catch (e) { return false; }
    return true;
  }

  function isNumeric(n) {
    //  Return true if numeric.
    return !isNaN(parseFloat(n)) && isFinite(n);
  }

  function normaliseFieldName(fieldName) {
    //  If the field name contains spaces, change them to underscore. Make the field name lowercase.
    //  If we have defined a renamed field, return it.
    if (fieldNames[fieldName]) return fieldNames[fieldName];
    return fieldName.toLowerCase().split(' ').join('_');
  }

  //  This is the list of fields to match in the log, and the renamed field.
  const fieldNames = {
    'Action': null,
    'CLIENTID': null,
    'EVENT': null,
    'Function': null,
    'HashKeyField': null,
    'HashKeyValue': null,
    'Matching rule found': null,
    'MESSAGE': 'result',  //  Conflicts with Sumo Logic's Message field.
    'Message arrived on': null,
    'Message Id': null,
    'PRINCIPALID': 'principal',  //  Drop this field because we have Thingname.
    'RangeKeyField': null,
    'RangeKeyValue': null,
    'Request ID': null,
    'Status': null,
    'StatusCode': 'status',
    'Status Code': 'status',
    'Table': null,
    'Target Arn': null,
    'THINGNAME': 'device',
    'TOPICNAME': 'topic',
    'TRACEID': 'traceId',

    //  Additional fields from SetDesiredState.
    'LoadingFunction': null,
    'ReceivedEvent': null,
    'ReceivedRESTEvent': null,
    'ReceivedSlackEvent': null,
    'SendToSlack': null,
    'GotSlackResponse': null,
    'SendToAWS': null,
    'GotAWSResponse': null,
    'GotAWSResponsePayload': null
  };

  //  This is needed to defer the require(...) statements till later.
  return handler(event, context, callback);
};

exports.handler = (event, context, callback) => {
  //  Define the entry point for the lambda.  Call autorequire to catch
  //  any missing modules and install them.
  return setupAutoRequire()  //  Wait for autorequire to be set up before calling.
    .then(res => autorequire(main, __dirname, __filename)(event, context, callback))
    .catch(err => callback(err));
};

function setupAutoRequire() {
  //  Set up autorequire to catch any missing modules and install them.
  if (autorequire) return Promise.resolve(autorequire);
  //  Copy autorequire.js from GitHub to /tmp and load the module.
  //  TODO: If script already in /tmp, use it.  Else download from GitHub.
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    require('https').get('https://raw.githubusercontent.com/lupyuen/AWSIOT/master/nodejs/autorequire.js', res => {
      let body = '';
      res.on('data', chunk => body += chunk); // Accumulate the data chunks.
      res.on('end', () => { //  After downloading from GitHub, save to /tmp amd load the module.
        fs.writeFileSync('/tmp/autorequire.js', body);
        autorequire = require('/tmp/autorequire');
        return resolve(autorequire);
      })
    }).on('error', err => { console.error({setupAutoRequire: err}); return reject(err); });
  });
}

//  Unit test cases that will be run on a local PC/Mac instead of AWS Lambda.

function isProduction() {
  //  Return true if this is production server.
  if (process.env.LAMBDA_TASK_ROOT) return true;
  var environment = process.env.NODE_ENV || 'development';
  return environment !== 'development';
}

//  AWS IoT Log
const test_input1 = {
  "awslogs": {
    "data": "H4sIAAAAAAAAAO2XW2/bNhTHvwph7GED7Jj3i/pkOE5nLDfYbvtQFAEtUbYwWfJEKVla9LvvUHKadK3rtgu2YJtfDPFyePg/P/IcvuttnPd25Ra3W9eLesejxejqbDKfj55Pev1eeVO4CpqFEUoZog03GJrzcvW8Kpst9IxezadlfVqufNc+rytnN2FKzKWzCpM0NXFC7BKn8VJQuxQpwSaV1FjmHKZmKTFVhqZaU6uXKUmETO2SgjnfLH1cZds6K4uTLK9d5XvR696p3SwT2y10NS0S9zs40XrwpnVhcu2KOox818sS8IRRiRWVDEtCNGGcUUEU1UYwRgmWmCjCpWCEc0m5lJJryjmlHDyoM5CnthvYKYyhBFzl3BDSv5MNzFNM5ACLAaYIs4ipiPIjGIIWs9F4Mj2OklTFBms3ENiwAYddDyymeJCkwjChY4wThy5n0/Px9HJ0ChP+qnLo9fT85OINQpOXk/NFdNks88yvW1XQ4uJyOj4fnU2iH+yNH9brrFj54UrrbTb0a5uUN8Nmm9jaoR0Ed9OnBZrXtm58hOYvxmPo7L3vfyqwxAILxQn8EcwEfCsOu8SEUG64AvmZoJJoRQk1ewVm+KDADD81gS+ab5B3aOPYbWuX/FnnYOUrhKYBWEM54xr+Fedcc0wE1VoRhg0VPIzl1EAINN0rtFIHhVbqyQh9Zus4KDprcndSNkXyPXqPT6dgC5wrhvaD+HeWUQWmURpsRwjMXFUuLqvkyrvCl9UVWLKfjQYEQRjNjOQUU2I4UM6YBqEJ4I85J5RobLAy4STsjYYWB6OhxX83GurKxsVXRiTc7IrA7c5Bc8oxptIwYyAMVBM4HZIxySQcIEmx3nfTC5j25YiIIxjyZCJyfFvYTTmKQ76cNyCx948Wk529tMnzW7SFS6pbDHXhOEJnnUrIVlV2DUbKIkJfu2IfdT5HKGmN9tHCLnN3H/MHwe4j9LP161/c7UnmcuAicddZ7Pp3rS9t3rQzYbk+mtli5e7Hfgjyfc9u/H1oF4TsDhskK2nI5+jiWMOhxoQqwZQJFYXhcP5JuISV0HDmQylBhYQ7Ae9LcwLzA3UE0MWfTh3xL6RLf5GsB7R8DNd+WD4hrrP/CW42zz/LFSUcEgGgpCiUkBrLwA9EiAjMgClIMCwkFaEBQLmfqwNZPXD1dLJ6V87/DVxlxXX5K4zM2wVR2hTtmo9FV2e2j052diHKVRGBmajriRo/uIFoDWj08DkV3fkRtU+ZeQvMMfC4KwPHZdIiR+8tI1dVZRWhotmDEddECyY4gR/XAtIdhjoc1pQmvG+IMTK8fhg0mf3XkzAHMRLmf4yeGkZAUBL4qctJbn2dxXNnq3gtvpsnxSD2PLx7mYJLTphQ4EJdRZmE60rBM8QwopmCl4bmYu+1BEQd4gmG/JM8TWazi9kHoObn8y4mJzbLm8o9Gk3BHvTVJWS69s2HYCn43GbxEVqsXReOkPtcy9GN9eiFd9U9Cb720cfRt943G5cMqjJ3w2m5OC1Xq1Cbh09yMx69Va/GKPOoKGtkm3pdVtnbnQ+uSstqEwUn7h6hgC4s78umit2DVQu/D76QSuuyXIP1H+euChVZhEYb+xbO4vn82Q491LHHMXuGJu0eu4bRziEb1G47nqGZ+62BhRBoh1i8BNAAhaWWciAUiweWcTPACXVKJGxpaPLTY50/2GWoEKqVq9GoKr5x+733b97/AU2Sk2ZUEwAA"
  }
};

//  API Gateway Log
const test_input2a =
{
  "awslogs": {
    "data": "H4sIAAAAAAAAAK2VW2/iOBSA/4rFQzU7S0KcxEmMlAcKlF7oDLvQTkerEXJiA1FJnHGcBlr1v+8xDO222pWqdl8i5/jY5ztXP7RyUVVsKWbbUrS6rUFv1ptfDqfT3mjYardkUwgFYkJJGFIcUZ86IF7L5UjJuoSd3uTMGjEtGra1hhuR1jqThTWWy2qON5re3oUkyzqlknx/bqqVYDkcXDjUI8JPOaGuw1iQhimlASNCEI+FzgLUqzqpUpWV5sqTbK2Fqlrdv1pjliec7S+anxVcbHrfpsZi68fOxPBOFNpoPrQyDpY8N3ApJTRyceREUUCx71ASRNjDEXH9KMA49CIfuwHxfMcNfOyblQ8EOoPwaJaDpyD0cBg5jhuRsH0IG1w/1UzprFgicXAfLaRCSvys4WwX8SBimHm+hSmJLIxFYDGKE4uEAcNJ4HIaLlqP7Y/BkjfCns5mE3Qp9EryLpp8nc7a6E9RyVqlAk2YXnVRp5fqGhI6EHdZKk6UzKdrlt5+mDB4I+Ee7hA+VO6gHh4/bD98n334qi2qtIIM/y8c0fs4VoJxqH9A6KWpKHX8ufO5jfprWXPIUaGt60w0Qll9WRdabeOr6YvdE6kaprjg1kRJLeOV1mX1QuOssmYsWYvDTfGCrSvxWuVSJtlavFK5qsBwbwldF+9qJZEaYdtBn37fmel2OqzM7Mps2anMO0qCRvVbG928jWuaQ4fNrl9ZPZWVjp9njL1vP2EZW3VlNRA1y7VZzu5lwZrKWG6jffCsYZFKDhmNl/dZ2eZisYaKf8UjlY5932uj64zF2MYIR9gVEU0SnDJM2YL7kOrQ8xj2ScgjYqeGemGo7UJo9OnZi52vvfze6i+sMx5fJRt6MS83+WlxdjP/OVdjcnO+Ou8v3eaWz5g4Gfat4UB9T+6dDXFu6vPtd+00cfySEFYx8W3XobbrYRtKro3Mv0dtILID93UcB6K61bI8xFGr2uQXNiFzlnkAYlaW6yxlZoh1NlbTNBaMstyq1VqYiAn+8fqn76v/RPItSgTgCKQVKyoDtgOFntDyVhTxkPW/FIu8GRXF2B06x6ugP+udBupIm4ci4/HModOb0beL0V7CZc6yItallUl9BDVsBp7Rw57nArjvEXKUrlhRiLUR953B8feJP/7jSViwXMTLKGJHTx7FTw5BB8DHcY5quNqcv5qOe/2L46+zvWR3uPrVL0C00fERrIzmsTO8DMeDgbcTHKyU2b8GnwY+DYE1hBlL3JD4IVSAF+AwCDwXY4qpBxkxLsGZ/wx+4P8z+MPnp4xBv3PEawi7RKksFtmyVrvAI6GUVF10VZi5YbafEnNI24eBvTcC/6oW6PESRhgAN5lewdhmuob6II7Tevzx+DdLuYWW7QgAAA=="
  }
};

//  SetDesiredState Lambda Log
const test_input2b =
{
  "awslogs": {
    "data": "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"
  }
};

//  Sensor Data for AWS IoT version 2016-03-23-beta.  Note the new "input->state".
const test_input3 =
{
  "state": {
    "reported": {
      "occupied": false,
      "humidity": 44,
      "timestamp": "2016-05-13T22:34:29.138750",
      "temperature": 31.4,
      "sound_level": 334,
      "light_level": 267
    }
  },
  "metadata": {
    "reported": {
      "humidity": {
        "timestamp": 1463150093
      },
      "timestamp": {
        "timestamp": 1463150093
      },
      "temperature": {
        "timestamp": 1463150093
      },
      "sound_level": {
        "timestamp": 1463150093
      },
      "light_level": {
        "timestamp": 1463150093
      }
    }
  },
  "version": 9142,
  "timestamp": 1463150093,
  "topic": "$aws/things/g87pi/shadow/update/accepted",
  "traceId": "081f1280-93f9-4b94-88a9-7c3813136398"
};

//  Another variant of Sensor Data for AWS IoT version 2016-03-23-beta.  Note the new "input->state".
const test_input4 =
{
  "input": {
    "state": {
      "reported": {
        "humidity": 44,
        "timestamp": "2016-05-09T07:58:29.138750",
        "temperature": 31.1,
        "sound_level": 334,
        "light_level": 267
      }
    },
    "metadata": {
      "reported": {
        "humidity": {
          "timestamp": 1463146990
        },
        "timestamp": {
          "timestamp": 1463146990
        },
        "temperature": {
          "timestamp": 1463146990
        },
        "sound_level": {
          "timestamp": 1463146990
        },
        "light_level": {
          "timestamp": 1463146990
        }
      }
    },
    "version": 9139,
    "timestamp": 1463146990,
    "topic": "$aws/things/g87pi/shadow/update/accepted",
    "traceId": "33e6c7e3-ba1e-48fe-a535-98ff5b37834f"
  }
};

//  Sensor Data for AWS IoT version 2015-10-08
/*
 const test_input = {
 "timestamp": 1462090920,
 "version": 1227,
 "metadata": {
 "timestamp": 1462090920
 },
 "reported": {
 "sound_level": 324,
 "timestamp": "2016-05-01T16:22:00.347743",
 "humidity": 45,
 "temperature": 33,
 "light_level": 792
 },
 "topic": "$aws/things/g87pi/shadow/update/accepted",
 "traceId": "4fb3ed68-ec3f-42b6-a202-4207c9c55a2a"
 };
 */

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
function runTest() {
  return exports.handler(test_input3, test_context, function(err, result) {
    if (err) console.error(err);
    else console.log(result);
  });
}

if (!isProduction()) runTest();
