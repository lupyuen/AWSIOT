'use strict';

//  Send IoT sensor data and AWS IoT Logs to Sumo Logic and Slack for searching and dashboards
//  Node.js 4.3 / index.handler / lambda_iot / 512 MB / 1 min / No VPC
//  This AWS Lambda function accepts a JSON input of sensor values and sends them to Sumo Logic
//  search engine for indexing.  It also sends to AWS CloudWatch and posts a message to Slack.
//  The input looks like:
//  {"temperature":84,"timestampText":"2015-10-11T09:18:51.604Z","version":139,
//  "xTopic":"$aws/things/g88pi/shadow/update/accepted","xClientToken":"myAwsClientId-0"}

//  To configure this lambda as CloudWatch Subscription Filter:
//  Click CloudWatch --> Logs
//  Click checkbox for AWSIoTLogs
//  Click Actions --> Stream to AWS Lambda
//  Select "IndexAWSLogs"
//  Select Log Format = Other, set Subscription Filter Pattern to blank

//  This lambda function must be run as role lambda_iot.
//  lambda_iot must be attached to policy LambdaExecuteIoTUpdate,
//  see github.com/lupyuen/AWSIOT/policy/LambdaExecuteIoTUpdate.txt

console.log('Loading function');

//  List of device names and the replacement Slack channels for the device.
//  Used if the channel name is already taken up.  Sync this with
//  ActuateDeviceFromSlack and SetDesiredState.
const replaceSlackChannels = {
  g88: 'g88a',
};

const https = require('https');
const zlib = require('zlib');
const AWS = require('aws-sdk');

//  Init the AWS connection.
AWS.config.region = 'us-west-2';
AWS.config.logger = process.stdout;  //  Debug
if (!process.env.LAMBDA_TASK_ROOT) { /* eslint-disable import/no-unresolved */
  //  For unit test, set the credentials.
  const config = require('os').platform() === 'win32' ?
    require('../../../unabiz-emulator/config.json') :
    require('../../../../SIGFOX/unabiz-emulator/config.json');
  AWS.config.credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
} /* eslint-enable import/no-unresolved */
const cloudwatch = new AWS.CloudWatch();

//  This lambda uses autorequire to install any missing require(...) modules
//  automatically.  This is useful for AWS Lambda because otherwise we need to
//  upload all the modules as a zipped package and we lose the inline editing capability.
let autorequire = null;
let mysql = null;
let pool = null;

const main = (event, context, callback) => {
  //  This is the main execution scope.  All non-system require(...)
  //  statements must be put here.

  //  This missing module is normally not allowed for inline lambda.  But
  //  autorequire will install the module automatically for us.
  if (!mysql) mysql = require('mysql2/promise');

  //  Create pool of database connections.
  if (!pool) pool = mysql.createPool({
    host: 'iotdb.culga9y9tfvw.us-west-2.rds.amazonaws.com',
    user: 'root',
    password: 'iotattp4me',
    database: 'iotdb',
  });

  function handler(input, context2, callback2) {
    //  This is the main program flow after resolving the missing modules.
    if (input.domain) delete input.domain;  //  TODO: Contains self-reference loop.
    console.log('Input:', JSON.stringify(input, null, 2));
    console.log('Context:', context2);
    //  Don't index response to set desired state.
    if (input.state && input.state.desired) {
      return callback2(null, 'Ignoring response to set desired state');
    }
    let device = null;
    //  Unzip the logs if we are processing CloudWatch logs (IndexAWSLogs).
    return unzipLogs(input)
      .then((awslogsData) => {
        if (awslogsData) return awslogsData;
        //  Else index the sensor data (IndexSensorData).
        const ret = processSensorData(input, context2);
        device = ret.device;
        return ret.awslogsData;
      })
      .then((awslogsData) => {
        //  This Sumo Logic Collector URL is unique to us: Sensor Data Logs
        const url = 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/ZaVnC4dhaV2spqT2JdXJBek02aporY-ujTTn2eTcc3XfNomF_U94P6-YIpFZ6FIyAJqG9rNtzNK0JmP13upzBiH8FUfaSMyQmXqgfMdfSGazF6czrBHHxw==';
        //  Process the logs, write to MySQL and Sumo Logic.
        return processLogs(url, device, awslogsData);
      })
      //  If no errors, return the result to AWS.
      .then(res => callback2(null, res))
      //  Or return the error to AWS.
      .catch(err => callback2(err));
  }

  function unzipLogs(input) {
    //  Unzip the log records.  Returns a promise.
    //  Index the AWS Logs.  Decode input from base64.
    if (!input.awslogs) return Promise.resolve(null);
    const zippedInput = new Buffer(input.awslogs.data, 'base64');
    //  Decompress the input
    return new Promise((resolve, reject) => {
      return zlib.gunzip(zippedInput, (e, buffer) => {
        if (e) {
          console.error(e);
          return reject(e);
        }
        const awslogsData = JSON.parse(buffer.toString('ascii'));
        return resolve(awslogsData);
      });
    });
  }

  function processLogs(url, device, awslogsData) {
    //  Transform the input to JSON messages for indexing, then write to MySQL and Sumo Logic.
    //  Returns a promise.
    const records = transformLog(awslogsData);
    //  Skip control messages.
    if (!records) return Promise.resolve('Received a control message');

    //  awslogsData.logEvents["0"].extractedFields.current.state.reported
    //  Write JSON messages to MySQL.
    const promises = [];
    if (device && device.toLowerCase() !== 'unknown') {
      for (const record of records) {
        const promise = writeDatabase(device, record, context);
        promises.push(promise);
      }
    }
    //  Post JSON messages to Sumo Logic.
    const promise = postLogsToSumoLogic(url, records, device);
    promises.push(promise);

    //  We have accumulated a list of MySQL and SumoLogic updates.  Wait for all of them.
    return Promise.all(promises);
  }

  function writeDatabase(device, event2 /* context2 */) {
    //  Write the record to MySQL database.  Returns a promise.
    if (!device) return Promise.resolve(null);
    //  If device is g88pi, group is g88
    let group = device;
    if (group.toLowerCase().endsWith('pi')) group = group.substr(0, group.length - 2);
    const table = `${group}_sensor_data`;
    //  Connect to the MySQL database.
    return pool.getConnection()
    //  Create table if it doesn't exist.
      .then(conn => createTable(table, conn))
      .then((conn) => {
        const timestamp = event2.sensor_timestamp || event2.timestamp || new Date();
        const promises = [];
        //  Insert each sensor value in a separate MySQL row.
        for (const key in event2) { /* eslint-disable no-continue */
          if (key === 'timestamp' || key === 'sensor_timestamp') continue;
          /* eslint-enable no-continue */
          const val = event2[key];
          const row = { timestamp, sensor: key };
          //  Write numbers into 'number' field and strings into 'text' field.
          if (typeof val === 'number') row.number = val;
          else if (typeof val === 'string') row.text = val;
          else row.text = JSON.stringify(val);  //  Everything else write as JSON.
          console.log(`Writing key ${key}=${val}, ${JSON.stringify(row)}`);

          //  Accumulate each promise and wait for all promises.
          const promise = conn.query('insert into ?? set ?', [table, row]);
          promises.push(promise);
        }
        //  Wait for all queries to complete.
        return Promise.all(promises)
          .then((res) => {
            conn.release();
            return res;
          });
      })
      .catch((err) => {
        console.error({ handler: err });
        throw err;
      });
  }

  function createTable(table, conn) {
    //  Create the xx_sensor_data table in MySQL if it doesn't exist.  Returns a promise.
    const sql = `
      CREATE TABLE ?? (
        timestamp datetime NOT NULL,
        sensor varchar(64) NOT NULL,
        number double DEFAULT NULL,
        text varchar(256) DEFAULT NULL,
        PRIMARY KEY (timestamp, sensor)
      ) ENGINE=InnoDB DEFAULT CHARSET=latin1;    
    `;
    return conn.query(sql, [table])
      .then((res) => {
        console.log(JSON.stringify({ createTable: { table, res } }, null, 2));
        return conn;
      })
      .catch((err) => {
        //  Suppress errors in case table already exists.
        if (err.code !== 'ER_TABLE_EXISTS_ERROR') {
          console.log(JSON.stringify({ createTable: { table, err } }, null, 2));
        }
        return conn;
      });
  }

  let default_device = 'Unknown';

  function getDevice(input) {
    //  Get the device name e.g. g88pi.
    if (input.device) return input.device;
    let device = default_device;
    let topic = null;
    if (input.topic) topic = input.topic;
    else if (input.input && input.input.topic) topic = input.input.topic;
    if (topic) {
      //  We split the topic to get the device name.  The topic looks like
      //  "$aws/things/g88pi/shadow/update/accepted"
      const topicArray = topic.split('/');
      if (topicArray.length >= 3) {
        device = topicArray[2];
        console.log(`device=${device}`);
      }
    }
    //  If this is a Slack message, get the device name from the channel.
    //  Use the same device name for the rest of the log file.
    if (device === 'Unknown' && input.channel_name) {
      default_device = mapChannelToDevice(input.channel_name);
      device = default_device;
    }
    return device;
  }

  function mapChannelToDevice(channel) {
    //  Map the Slack channel to device name.  e.g. g88a will return g88pi
    for (const key in replaceSlackChannels) {
      if (replaceSlackChannels[key] === channel) return `${key}pi`;
    }
    return `${channel}pi`;
  }

  function processSensorData(input, context2) {
    //  Format the sensor data into a Sumo Logic update request.  Returns the log records.
    //  console.log(JSON.stringify({input: input})); ////
    const extractedFields = {};
    let action = '';
    const device = getDevice(input);
    extractedFields.device = device;
    let sensor_data = null;

    //  For shadow/update/documents, sensor data is in current.state.reported
    if (input.current && input.current.state && input.current.state.reported) {
      sensor_data = JSON.parse(JSON.stringify(input.current.state.reported));
      delete input.current;
      delete input.previous;  //  Don't log the previous state.
    } else if (input.state && input.state.reported) {
      //  For AWS IoT 2016-03-23-beta, sensor data is located in the field
      //  "state->reported" or "input->state->reported".  We move them up to top level.
      sensor_data = JSON.parse(JSON.stringify(input.state.reported));
      delete input.state;
    } else if (input.input && input.input.state && input.input.state.reported) {
      sensor_data = JSON.parse(JSON.stringify(input.input.state.reported));
      delete input.input;
    } else if (input.reported) {
      //  For AWS IoT 2015-10-08, sensor data is located in the field "reported".
      //  We move them up to top level.
      sensor_data = JSON.parse(JSON.stringify(input.reported));
      delete input.reported;
    }
    if (sensor_data) {
      for (const key in sensor_data) {
        input[key] = sensor_data[key];
      }
    }
    if (input.metadata) delete input.metadata;

    //  Copy the keys and values for indexing.
    let actionCount = 0;
    const sensorData = {};
    const promises = [];
    for (const key in input) {
      const value = input[key];
      extractedFields[key] = value;
      if (action.length > 0) action = `${action}, `;
      action = `${action}${key}: ${value}`;
      actionCount += 1;
      //  Don't send non-sensor fields to Slack.
      /* eslint-disable no-continue */
      if (key === 'traceId') continue; /* eslint-enable no-continue */
      sensorData[key] = value;
      //  If the value is numeric, send the metric to CloudWatch.
      if (key !== 'version' && !isNaN(value) && typeof value === 'number') {
        const promise = writeMetricToCloudWatch(device, key, value);
        promises.push(promise);  //  Don't wait for completion.
      }
    }
    if (!extractedFields.event) extractedFields.event = 'IndexSensorData';

    const awslogsData = {
      logGroup: device,
      logStream: device,
      logEvents: [{
        id: context2.awsRequestId,
        timestamp: 1 * (new Date()),
        message: JSON.stringify(input),
        extractedFields,
      }],
    };
    console.log('IndexSensorData awslogsData:', JSON.stringify(awslogsData));
    //  Post a Slack message to the private group of the same name e.g. g88.
    postSensorDataToSlack(device, sensorData);  //  Don't wait for response.
    return { device, actionCount, awslogsData };
  }

  function transformLog(payload) {
    //  Transform the log into Sumo Logic format.  Returns an array of JSON objects.
    if (payload.messageType === 'CONTROL_MESSAGE') return null;
    const bulkRequestBody = [];
    payload.logEvents.forEach((logEvent) => {
      //  Parse any JSON fields.
      if (!logEvent.extractedFields) {
        logEvent.extractedFields = extractJson(logEvent.message);
        if (logEvent.extractedFields) {
          logEvent.extractedFields = JSON.parse(logEvent.extractedFields);
        } else logEvent.extractedFields = {};
      }
      //  Save the sensor timestamp for logging to MySQL.
      if (logEvent.extractedFields.timestamp) {
        logEvent.extractedFields.sensor_timestamp = logEvent.extractedFields.timestamp;
      }
      //  Timestamp must be first field or Sumo Logic may pick another field.
      const timestamp = new Date(1 * logEvent.timestamp);
      logEvent.extractedFields.timestamp = timestamp.toISOString();

      //  logevent.extractedFields.data contains "EVENT:UpdateThingShadow
      //  TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
      //  We extract the fields.
      parseIoTFields(logEvent);
      const source = buildSource(logEvent.message, logEvent.extractedFields);
      //  source['id'] = logEvent.id;  //  Ignore ID because it is very long.
      console.log(`transformLog: ${logEvent.message} =>\n${JSON.stringify(source)}`);
      bulkRequestBody.push(source);
    });
    return bulkRequestBody;
  }

  function buildSource(message, extractedFields) {
    //  Combine the extracted fields with the message fields.
    if (extractedFields) {
      const source = {};
      for (const key in extractedFields) {
        const value = extractedFields[key];
        if (isNumeric(value)) {
          source[key] = 1 * value;
          continue;
        }
        const jsonSubString = extractJson(value);
        if (jsonSubString !== null) {
          source[`$${key}`] = JSON.parse(jsonSubString);
        }
        source[key] = value;
      }
      return source;
    }
    const jsonSubString2 = extractJson(message);
    if (jsonSubString2 !== null) {
      return JSON.parse(jsonSubString2);
    }
    return {};
  }

  function parseIoTFields(logEvent) {
    // logevent.extractedFields.data contains "EVENT:UpdateThingShadow
    // TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    // We extract the fields.  Do the same for logevent.extractedFields.event.
    // Also we remove "TRACEID:", "PRINCIPALID:", "EVENT:" from the existing fields.
    //  console.log("parseIoTFields logEvent=", JSON.stringify(logEvent));
    const fields = logEvent.extractedFields;
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
    switch (fields.event) {
      case 'SNSActionFailure':
        fields.function = fields.target_arn; break;
      case 'MatchingRuleFound':
        fields.function = fields.matching_rule_found; break;
      case 'PublishOut':
      case 'PublishEvent': {
        const topic_split = fields.topic.split('/');
        fields.function = topic_split[topic_split.length - 1]; break;
      }
      case 'LambdaActionSuccess':
        fields.status2 = fields.status;
        if (fields.status.startsWith('202')) fields.status = 'SUCCESS';
        break;
      default:
    }
  }

  function parseIoTData(fields, data) {
    // data contains "EVENT:UpdateThingShadow
    // TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    // We extract the fields and populate into the "fields" collection.
    let pos = 0;
    let lastPos = -1;
    let lastFieldName = null;
    for (;;) {
      const match = matchIoTField(data, pos);
      if (match.pos < 0) break;
      if (lastPos < 0) {
        //  First iteration.
        lastPos = match.pos + 1;
        lastFieldName = match.fieldName;
      } else {
        //  Extract from lastPos to match.pos.
        const nameAndValue = data.substring(lastPos, match.pos);
        fields[normaliseFieldName(lastFieldName)] = nameAndValue.substr(
          lastFieldName.length + 1).trim();
        lastPos = match.pos;
        lastFieldName = match.fieldName;
        pos = match.pos + 1;
      }
    }
    //  Extract the last field.
    if (lastPos >= 0) {
      const nameAndValue2 = data.substr(lastPos);
      fields[normaliseFieldName(lastFieldName)] = nameAndValue2.substr(
        lastFieldName.length + 1).trim();
    }
    return '';
  }

  function matchIoTField(data, pos) {
    //  event contains "EVENT:UpdateThingShadow
    //  TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    //  We return the next position on or after pos that matches an IoT field
    //  (e.g. "EVENT:"), and return the field name.
    if (pos >= data.length) return { pos: -1, fieldName: '' };
    let matchPos = -1;
    let matchFieldName = null;
    for (const fieldName in fieldNames) {
      const fieldPos = data.toLowerCase().indexOf(`${fieldName.toLowerCase()}:`, pos);
      if (fieldPos < 0) continue;
      if (matchPos < 0 || fieldPos < matchPos) {
        matchPos = fieldPos;
        //  Rename the field if necessary.
        matchFieldName = fieldName;
      }
    }
    return {
      pos: matchPos,
      fieldName: matchFieldName,
    };
  }

  function postLogsToSumoLogic(url, body, tags) {
    return Promise.resolve('OK');  ////  Disable Sumo Logic logging.
      
    //  Post the sensor data logs to Sumo Logic via HTTPS.  Body contains an array
    //  of JSON objects.  Returns a promise.
    //  Change timestamp to Sumo Logic format: "timestamp":"2016-02-08T00:19:14.325Z" -->
    //    "timestamp":"2016-02-08T00:19:14.325+0000"
    let body2 = body.map(JSON.stringify).join('\n');  //  Convert to list of lines.
    body2 = body2.replace(/("timestamp":"[^"]+)Z"/g, '$1+0000"');
    console.log(`postLogsToSumoLogic: body=${body2}`);
    const url_split = url.split('/', 4);
    const host = url_split[2];
    const path = url.substr(url.indexOf(host) + host.length);
    const request_params = {
      host,
      path,
      body: body2,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body2),
        'X-Sumo-Name': tags || 'Logger',
      },
    };
    //  Return this as a promise so we can wait for multiple items easily.
    return new Promise((resolve, reject) => {
      const request = https.request(request_params, (response) => {
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
    //  Write the sensor data as a metric to CloudWatch.  Returns a promise.
    if (typeof value !== 'number') return Promise.resolve(null);
    //  console.log('writeMetricToCloudWatch:', device, metric, value);
    const params = {
      MetricData: [{
        MetricName: metric,
        Timestamp: new Date(),
        Unit: 'None',
        Value: value,
      }],
      Namespace: device,
    };
    return cloudwatch.putMetricData(params).promise()
      .then((data) => {
        //  console.log('putMetricData: ', data);  // successful response
        return data;
      })
      .catch((error) => {
        console.log('putMetricData error:', { error, device, metric, value });
        return null;  //  Suppress error.
      });
  }

  //  Map group name to the search results for the group (search results -> share):
  const search_by_group = {
  };

  function postSensorDataToSlack(device, sensorData) {
    //  Post the sensor values to a Slack group for the device e.g. g88.
    //  device is assumed to begin with the group name. sensorData contains
    //  the sensor values.  Returns a promise.
    if (!device) return Promise.resolve(null);
    console.log(JSON.stringify({ sensorData }));

    let channel = '';
    const pos = device.indexOf('_');
    if (pos > 0) channel = device.substring(0, pos);
    //  http://d3gc5unrxwbvlo.cloudfront.net/_plugin/kibana/#/discover/Sensor-Data?_g=(refreshInterval:(display:'10%20seconds',section:1,value:10000),time:(from:now-1d,mode:quick,to:now))&_a=(query:(query_string:(analyze_wildcard:!t,query:'%%CHANNEL%%*')))'
    let url = search_by_group[device] || 'http://sumologic.com';
    url = url.split('%%CHANNEL%%').join(channel);
    //  Clone a copy.
    const sensorData2 = JSON.parse(JSON.stringify(sensorData));
    //  Combine the less important fields.
    let otherFields = '';
    if (sensorData2.timestampText) {
      otherFields = `${otherFields} - ${sensorData2.timestampText.substr(0, 19)}`;
      delete sensorData2.timestampText;
    }
    if (sensorData2.topic) {
      otherFields = `${otherFields} - ${sensorData2.topic}`;
      delete sensorData2.topic;
    }
    if (sensorData2.version) {
      otherFields = `${otherFields} - ${sensorData2.version}`;
      delete sensorData2.version;
    }
    //  Add each field.
    const fields = [];
    for (const key in sensorData2) {
      fields.push({ title: key, value: `${sensorData2[key]}`, short: true });
    }
    if (otherFields.length > 0) {
      fields.push({ title: '', value: `_${otherFields}_`, short: false });
    }
    //  Compose and send the attachment to Slack.
    const attachment = {
      mrkdwn_in: ['fields'],
      fallback: JSON.stringify(sensorData),
      color: '#439FE0',
      //  'pretext': 'Optional text that appears above the attachment block',
      //  'author_name': 'Bobby Tables',
      //  'author_link': 'http://flickr.com/bobby/',
      //  'author_icon': 'http://flickr.com/icons/bobby.jpg',
      title: 'Received sensor data (Click for more...)',
      title_link: url,
      //  'text': 'Optional text that appears within the attachment',
      fields,
      //  'image_url': 'http://my-website.com/path/to/image.jpg',
      //  'thumb_url': 'http://example.com/path/to/thumb.png'
    };
    return postToSlack(device, [attachment], callback);
  }

  function postToSlack(device, textOrAttachments) {
    //  Post a Slack message to the private group of the same name e.g. g88.
    //  device is assumed to begin with the group name. text is the text
    //  message, attachments is the Slack rich text format.  Returns a promise.
    if (!device) return Promise.resolve(null);
    let channel = device;
    const pos = device.indexOf('_');
    if (pos > 0) channel = device.substring(0, pos);
    //  Change g88pi to g88.
    channel = channel.split('pi').join('');
    if (replaceSlackChannels[device]) channel = replaceSlackChannels[device];
    else if (replaceSlackChannels[channel]) channel = replaceSlackChannels[channel];
    const body = {
      channel: `#${channel}`,
      username: device,
    };
    if (textOrAttachments[0] && textOrAttachments[0].length === 1) {
      body.text = textOrAttachments;
    } else body.attachments = textOrAttachments;
    const options = {
      hostname: 'hooks.slack.com',
      path: '/services/T09SXGWKG/B1GR8D13N/D3nlpxoqZmNIKyTzBLM8OPV9',
      method: 'POST',
    };
    console.log('Slack request =', JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body2 = '';
        // console.log('Status:', res.statusCode);
        // console.log('Headers:', JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body2 += chunk;
        });
        res.on('end', () => {
          //  If we know it's JSON, parse it
          if (res.headers['content-type'] === 'application/json') {
            body2 = JSON.parse(body2);
          }
          console.log('Slack Result', body2);
          return resolve(body2);
        });
      });
      req.on('error', (e) => {
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
    const jsonStart = message.indexOf('{');
    if (jsonStart < 0) return null;
    const jsonSubString = message.substring(jsonStart);
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
    Action: null,
    CLIENTID: null,
    EVENT: null,
    Function: null,
    HashKeyField: null,
    HashKeyValue: null,
    'Matching rule found': null,
    MESSAGE: 'result',  //  Conflicts with Sumo Logic's Message field.
    'Message arrived on': null,
    'Message Id': null,
    PRINCIPALID: 'principal',  //  Drop this field because we have Thingname.
    RangeKeyField: null,
    RangeKeyValue: null,
    'Request ID': null,
    Status: null,
    StatusCode: 'status',
    'Status Code': 'status',
    Table: null,
    'Target Arn': null,
    THINGNAME: 'device',
    TOPICNAME: 'topic',
    TRACEID: 'traceId',

    //  Additional fields from SetDesiredState.
    LoadingFunction: null,
    ReceivedEvent: null,
    ReceivedRESTEvent: null,
    ReceivedSlackEvent: null,
    SendToSlack: null,
    GotSlackResponse: null,
    SendToAWS: null,
    GotAWSResponse: null,
    GotAWSResponsePayload: null,
  };

  //  This is needed to defer the require(...) statements till later.
  return handler(event, context, callback);
};

exports.handler = (event, context, callback) => {
  //  Define the entry point for the lambda.  Call autorequire to catch
  //  any missing modules and install them.
  return setupAutoRequire()  //  Wait for autorequire to be set up before calling.
    .then(() => autorequire(main, __dirname, __filename)(event, context, callback))
    .catch(err => callback(err));
};

function setupAutoRequire() {
  //  Set up autorequire to catch any missing modules and install them.
  if (autorequire) return Promise.resolve(autorequire);
  //  Copy autorequire.js from GitHub to /tmp and load the module.
  //  TODO: If script already in /tmp, use it.  Else download from GitHub.
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    require('https').get('https://raw.githubusercontent.com/lupyuen/AWSIOT/master/nodejs/autorequire.js', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; }); // Accumulate the data chunks.
      res.on('end', () => { //  After downloading from GitHub, save to /tmp amd load the module.
        fs.writeFileSync('/tmp/autorequire.js', body);
        /* eslint-disable import/no-absolute-path, import/no-unresolved */
        autorequire = require('/tmp/autorequire');
        return resolve(autorequire);
      });
    }).on('error', (err) => { console.error({ setupAutoRequire: err }); return reject(err); });
  });
}

//  Unit test cases that will be run on a local PC/Mac instead of AWS Lambda.

function isProduction() {
  //  Return true if this is production server.
  if (process.env.LAMBDA_TASK_ROOT) return true;
  const environment = process.env.NODE_ENV || 'development';
  return environment !== 'development';
}

/* eslint-disable no-unused-vars, quotes, quote-props, max-len, comma-dangle */
const test_input = {

  //  SIGFOX message
  IndexSensorData: {
    "previous": {
      "state": {
        "reported": {
          "humidity": 50,
          "timestamp": "2016-11-24T21:48:19.034",
          "temperature": 28,
          "sound_level": 300,
          "light_level": 200,
          "led": "on",
          "message": "OK",
          "beacons": {
            "B_b9407f30f5f8466eaff925556b57fe6d_17850_29219": {
              "uuid": "b9407f30f5f8466eaff925556b57fe6d",
              "major": 17850,
              "power": 182,
              "address": "E0:95:23:72:BA:45",
              "id": "B_b9407f30f5f8466eaff925556b57fe6d_17850_29219",
              "minor": 29219
            },
            "B_b9407f30f5f8466eaff925556b57fe6d_42535_61733": {
              "minor": 61733,
              "power": 182,
              "major": 42535,
              "id": "B_b9407f30f5f8466eaff925556b57fe6d_42535_61733",
              "address": "F8:CA:25:F1:83:35",
              "uuid": "b9407f30f5f8466eaff925556b57fe6d"
            }
          },
          "ctr": 9,
          "tmp": 36,
          "vlt": 12.3,
          "device": "temp_pi",
          "data": "920e5a00b051680194597b00",
          "key3": "value3",
          "key2": "value2",
          "key1": "value1",
          "resource": "/ProcessSIGFOXMessage",
          "path": "/ProcessSIGFOXMessage",
          "httpMethod": "GET",
          "headers": {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, sdch, br",
            "Accept-Language": "en-US,en;q=0.8",
            "Cache-Control": "max-age=0",
            "CloudFront-Forwarded-Proto": "https",
            "CloudFront-Is-Desktop-Viewer": "true",
            "CloudFront-Is-Mobile-Viewer": "false",
            "CloudFront-Is-SmartTV-Viewer": "false",
            "CloudFront-Is-Tablet-Viewer": "false",
            "CloudFront-Viewer-Country": "SG",
            "Host": "l0043j2svc.execute-api.us-west-2.amazonaws.com",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2925.0 Safari/537.36",
            "Via": "1.1 c038088d4b94486d7346fd44d03188a0.cloudfront.net (CloudFront)",
            "X-Amz-Cf-Id": "omfPxBotRHWplmFzvDR6ZNoL720H0B-WtVemWCyLtXPfJLu21BGWDA==",
            "X-Forwarded-For": "118.200.15.117, 54.240.148.212",
            "X-Forwarded-Port": "443",
            "X-Forwarded-Proto": "https"
          },
          "requestContext": {
            "accountId": "595779189490",
            "resourceId": "s3459w",
            "stage": "prod",
            "requestId": "59036929-af32-11e6-97da-112ad8d13953",
            "identity": {
              "sourceIp": "118.200.15.117",
              "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2925.0 Safari/537.36"
            },
            "resourcePath": "/ProcessSIGFOXMessage",
            "httpMethod": "GET",
            "apiId": "l0043j2svc"
          },
          "isBase64Encoded": false,
          "lig": 49
        }
      },
      "metadata": {
        "reported": {
          "humidity": {
            "timestamp": 1479620449
          },
          "timestamp": {
            "timestamp": 1479995299
          },
          "temperature": {
            "timestamp": 1479620449
          },
          "sound_level": {
            "timestamp": 1479620449
          },
          "light_level": {
            "timestamp": 1479620449
          },
          "led": {
            "timestamp": 1479620449
          },
          "message": {
            "timestamp": 1479620449
          },
          "beacons": {
            "B_b9407f30f5f8466eaff925556b57fe6d_17850_29219": {
              "uuid": {
                "timestamp": 1479620449
              },
              "major": {
                "timestamp": 1479620449
              },
              "power": {
                "timestamp": 1479620449
              },
              "address": {
                "timestamp": 1479620449
              },
              "id": {
                "timestamp": 1479620449
              },
              "minor": {
                "timestamp": 1479620449
              }
            },
            "B_b9407f30f5f8466eaff925556b57fe6d_42535_61733": {
              "minor": {
                "timestamp": 1479620449
              },
              "power": {
                "timestamp": 1479620449
              },
              "major": {
                "timestamp": 1479620449
              },
              "id": {
                "timestamp": 1479620449
              },
              "address": {
                "timestamp": 1479620449
              },
              "uuid": {
                "timestamp": 1479620449
              }
            }
          },
          "ctr": {
            "timestamp": 1479995299
          },
          "tmp": {
            "timestamp": 1479995299
          },
          "vlt": {
            "timestamp": 1479995299
          },
          "device": {
            "timestamp": 1479995299
          },
          "data": {
            "timestamp": 1479995299
          },
          "key3": {
            "timestamp": 1479651128
          },
          "key2": {
            "timestamp": 1479651128
          },
          "key1": {
            "timestamp": 1479651128
          },
          "resource": {
            "timestamp": 1479654145
          },
          "path": {
            "timestamp": 1479654145
          },
          "httpMethod": {
            "timestamp": 1479654145
          },
          "headers": {
            "Accept": {
              "timestamp": 1479654145
            },
            "Accept-Encoding": {
              "timestamp": 1479654145
            },
            "Accept-Language": {
              "timestamp": 1479654145
            },
            "Cache-Control": {
              "timestamp": 1479654145
            },
            "CloudFront-Forwarded-Proto": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-Desktop-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-Mobile-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-SmartTV-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-Tablet-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Viewer-Country": {
              "timestamp": 1479654145
            },
            "Host": {
              "timestamp": 1479654145
            },
            "Upgrade-Insecure-Requests": {
              "timestamp": 1479654145
            },
            "User-Agent": {
              "timestamp": 1479654145
            },
            "Via": {
              "timestamp": 1479654145
            },
            "X-Amz-Cf-Id": {
              "timestamp": 1479654145
            },
            "X-Forwarded-For": {
              "timestamp": 1479654145
            },
            "X-Forwarded-Port": {
              "timestamp": 1479654145
            },
            "X-Forwarded-Proto": {
              "timestamp": 1479654145
            }
          },
          "requestContext": {
            "accountId": {
              "timestamp": 1479654145
            },
            "resourceId": {
              "timestamp": 1479654145
            },
            "stage": {
              "timestamp": 1479654145
            },
            "requestId": {
              "timestamp": 1479654145
            },
            "identity": {
              "sourceIp": {
                "timestamp": 1479654145
              },
              "userAgent": {
                "timestamp": 1479654145
              }
            },
            "resourcePath": {
              "timestamp": 1479654145
            },
            "httpMethod": {
              "timestamp": 1479654145
            },
            "apiId": {
              "timestamp": 1479654145
            }
          },
          "isBase64Encoded": {
            "timestamp": 1479654145
          },
          "lig": {
            "timestamp": 1479924321
          }
        }
      },
      "version": 20621
    },
    "current": {
      "state": {
        "reported": {
          "humidity": 50,
          "timestamp": new Date().toISOString().replace('Z', ''),
          "temperature": 28,
          "sound_level": 300,
          "light_level": 200,
          "led": "on",
          "message": "OK",
          "beacons": {
            "B_b9407f30f5f8466eaff925556b57fe6d_17850_29219": {
              "uuid": "b9407f30f5f8466eaff925556b57fe6d",
              "major": 17850,
              "power": 182,
              "address": "E0:95:23:72:BA:45",
              "id": "B_b9407f30f5f8466eaff925556b57fe6d_17850_29219",
              "minor": 29219
            },
            "B_b9407f30f5f8466eaff925556b57fe6d_42535_61733": {
              "minor": 61733,
              "power": 182,
              "major": 42535,
              "id": "B_b9407f30f5f8466eaff925556b57fe6d_42535_61733",
              "address": "F8:CA:25:F1:83:35",
              "uuid": "b9407f30f5f8466eaff925556b57fe6d"
            }
          },
          "ctr": 9,
          "tmp": 36,
          "vlt": 12.3,
          "device": "g88pi",
          "data": "920e5a00b051680194597b00",
          "key3": "value3",
          "key2": "value2",
          "key1": "value1",
          "resource": "/ProcessSIGFOXMessage",
          "path": "/ProcessSIGFOXMessage",
          "httpMethod": "GET",
          "headers": {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, sdch, br",
            "Accept-Language": "en-US,en;q=0.8",
            "Cache-Control": "max-age=0",
            "CloudFront-Forwarded-Proto": "https",
            "CloudFront-Is-Desktop-Viewer": "true",
            "CloudFront-Is-Mobile-Viewer": "false",
            "CloudFront-Is-SmartTV-Viewer": "false",
            "CloudFront-Is-Tablet-Viewer": "false",
            "CloudFront-Viewer-Country": "SG",
            "Host": "l0043j2svc.execute-api.us-west-2.amazonaws.com",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2925.0 Safari/537.36",
            "Via": "1.1 c038088d4b94486d7346fd44d03188a0.cloudfront.net (CloudFront)",
            "X-Amz-Cf-Id": "omfPxBotRHWplmFzvDR6ZNoL720H0B-WtVemWCyLtXPfJLu21BGWDA==",
            "X-Forwarded-For": "118.200.15.117, 54.240.148.212",
            "X-Forwarded-Port": "443",
            "X-Forwarded-Proto": "https"
          },
          "requestContext": {
            "accountId": "595779189490",
            "resourceId": "s3459w",
            "stage": "prod",
            "requestId": "59036929-af32-11e6-97da-112ad8d13953",
            "identity": {
              "sourceIp": "118.200.15.117",
              "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2925.0 Safari/537.36"
            },
            "resourcePath": "/ProcessSIGFOXMessage",
            "httpMethod": "GET",
            "apiId": "l0043j2svc"
          },
          "isBase64Encoded": false,
          "lig": 49
        }
      },
      "metadata": {
        "reported": {
          "humidity": {
            "timestamp": 1479620449
          },
          "timestamp": {
            "timestamp": 1480013409
          },
          "temperature": {
            "timestamp": 1479620449
          },
          "sound_level": {
            "timestamp": 1479620449
          },
          "light_level": {
            "timestamp": 1479620449
          },
          "led": {
            "timestamp": 1479620449
          },
          "message": {
            "timestamp": 1479620449
          },
          "beacons": {
            "B_b9407f30f5f8466eaff925556b57fe6d_17850_29219": {
              "uuid": {
                "timestamp": 1479620449
              },
              "major": {
                "timestamp": 1479620449
              },
              "power": {
                "timestamp": 1479620449
              },
              "address": {
                "timestamp": 1479620449
              },
              "id": {
                "timestamp": 1479620449
              },
              "minor": {
                "timestamp": 1479620449
              }
            },
            "B_b9407f30f5f8466eaff925556b57fe6d_42535_61733": {
              "minor": {
                "timestamp": 1479620449
              },
              "power": {
                "timestamp": 1479620449
              },
              "major": {
                "timestamp": 1479620449
              },
              "id": {
                "timestamp": 1479620449
              },
              "address": {
                "timestamp": 1479620449
              },
              "uuid": {
                "timestamp": 1479620449
              }
            }
          },
          "ctr": {
            "timestamp": 1479995299
          },
          "tmp": {
            "timestamp": 1479995299
          },
          "vlt": {
            "timestamp": 1479995299
          },
          "device": {
            "timestamp": 1479995299
          },
          "data": {
            "timestamp": 1479995299
          },
          "key3": {
            "timestamp": 1480013409
          },
          "key2": {
            "timestamp": 1480013409
          },
          "key1": {
            "timestamp": 1480013409
          },
          "resource": {
            "timestamp": 1479654145
          },
          "path": {
            "timestamp": 1479654145
          },
          "httpMethod": {
            "timestamp": 1479654145
          },
          "headers": {
            "Accept": {
              "timestamp": 1479654145
            },
            "Accept-Encoding": {
              "timestamp": 1479654145
            },
            "Accept-Language": {
              "timestamp": 1479654145
            },
            "Cache-Control": {
              "timestamp": 1479654145
            },
            "CloudFront-Forwarded-Proto": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-Desktop-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-Mobile-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-SmartTV-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Is-Tablet-Viewer": {
              "timestamp": 1479654145
            },
            "CloudFront-Viewer-Country": {
              "timestamp": 1479654145
            },
            "Host": {
              "timestamp": 1479654145
            },
            "Upgrade-Insecure-Requests": {
              "timestamp": 1479654145
            },
            "User-Agent": {
              "timestamp": 1479654145
            },
            "Via": {
              "timestamp": 1479654145
            },
            "X-Amz-Cf-Id": {
              "timestamp": 1479654145
            },
            "X-Forwarded-For": {
              "timestamp": 1479654145
            },
            "X-Forwarded-Port": {
              "timestamp": 1479654145
            },
            "X-Forwarded-Proto": {
              "timestamp": 1479654145
            }
          },
          "requestContext": {
            "accountId": {
              "timestamp": 1479654145
            },
            "resourceId": {
              "timestamp": 1479654145
            },
            "stage": {
              "timestamp": 1479654145
            },
            "requestId": {
              "timestamp": 1479654145
            },
            "identity": {
              "sourceIp": {
                "timestamp": 1479654145
              },
              "userAgent": {
                "timestamp": 1479654145
              }
            },
            "resourcePath": {
              "timestamp": 1479654145
            },
            "httpMethod": {
              "timestamp": 1479654145
            },
            "apiId": {
              "timestamp": 1479654145
            }
          },
          "isBase64Encoded": {
            "timestamp": 1479654145
          },
          "lig": {
            "timestamp": 1479924321
          }
        }
      },
      "version": 20622
    },
    "timestamp": 1480013410,
    "topic": "$aws/things/g88pi/shadow/update/documents",
    "traceId": "4c8301c7-4911-e943-1671-29f7770b8aa0"
  },

  //  AWS IoT Log
  IndexAWSLogs: {
    "awslogs": {
      "data": "H4sIAAAAAAAAANWTWW+jMBSF/4qF5jEUr4D9hhJSMcrWkM6iqooIOCmaBEcGmlZV//tckrTSbGpHmpd5Q/bxdw/n2E/OTtd1ttGLx712lDOIFtFyHKdpdBk7PcccKm1hWUgRBJKEkksMy1uzubSm3cNO9DlNTDMym/q0njZWZ7ufjnjRfBp9vKbx1dXXwfV0sBj5tH+1nFmTw/Q0uRxOv4xPPv5CCgPrdlXnttw3pamG5bbRtnbUjTPKdqsiO1lZJlWhH8Dm0ePt0WR8r6umUz45ZQFeGcOYh4IFAQ0I86nvY0FZQLiUkmHKsY+J9AmngsA3lwELRMh9Dg6aEgJssh1kQXggZRiGVGLKei/BAp5i4ruEuJQjQhXGisoLkKDFPOrHyUBJJnHG89xd+WvsYhrkLiNi5cpQ4MJn+QpLgWbzZNJPZtEIDrydrXp/tr+VoptkMpzeIhR/iicLNc6a/K6sNvN2q4emrQq0mM6S/iQax+pDdqi9ptutvQ0l+9Kr77LCHLx2X2SN9gqTt7sub9QfJQAD/5WXofMle0UjC2y07uAKAWdpdW5ssax1VRu7BFTmPPd+KSyUTAjGBRE+dCdZyKUgVFAhJKekq0t2rVEquaDyT4VByW8VBpL/qLDTC4jy7mGkbd7J/11lZ+C63W4fUVndm2+6QNvjRLRuq+PQC/RiLLO2vAeBqRR69+AeOnlXZ24PDc9gBcBKAUeddlRbuwdo1KU/pKxejKjj+0+Pt2gAlwilTda0dd8UWiEKvb+SkbbWWIUq+C/n+fb5Oz8htQccBQAA"
    }
  },

  //  API Gateway Log
  IndexAWSLogs2: {
    "awslogs": {
      "data": "H4sIAAAAAAAAAK2VW2/iOBSA/4rFQzU7S0KcxEmMlAcKlF7oDLvQTkerEXJiA1FJnHGcBlr1v+8xDO222pWqdl8i5/jY5ztXP7RyUVVsKWbbUrS6rUFv1ptfDqfT3mjYardkUwgFYkJJGFIcUZ86IF7L5UjJuoSd3uTMGjEtGra1hhuR1jqThTWWy2qON5re3oUkyzqlknx/bqqVYDkcXDjUI8JPOaGuw1iQhimlASNCEI+FzgLUqzqpUpWV5sqTbK2Fqlrdv1pjliec7S+anxVcbHrfpsZi68fOxPBOFNpoPrQyDpY8N3ApJTRyceREUUCx71ASRNjDEXH9KMA49CIfuwHxfMcNfOyblQ8EOoPwaJaDpyD0cBg5jhuRsH0IG1w/1UzprFgicXAfLaRCSvys4WwX8SBimHm+hSmJLIxFYDGKE4uEAcNJ4HIaLlqP7Y/BkjfCns5mE3Qp9EryLpp8nc7a6E9RyVqlAk2YXnVRp5fqGhI6EHdZKk6UzKdrlt5+mDB4I+Ee7hA+VO6gHh4/bD98n334qi2qtIIM/y8c0fs4VoJxqH9A6KWpKHX8ufO5jfprWXPIUaGt60w0Qll9WRdabeOr6YvdE6kaprjg1kRJLeOV1mX1QuOssmYsWYvDTfGCrSvxWuVSJtlavFK5qsBwbwldF+9qJZEaYdtBn37fmel2OqzM7Mps2anMO0qCRvVbG928jWuaQ4fNrl9ZPZWVjp9njL1vP2EZW3VlNRA1y7VZzu5lwZrKWG6jffCsYZFKDhmNl/dZ2eZisYaKf8UjlY5932uj64zF2MYIR9gVEU0SnDJM2YL7kOrQ8xj2ScgjYqeGemGo7UJo9OnZi52vvfze6i+sMx5fJRt6MS83+WlxdjP/OVdjcnO+Ou8v3eaWz5g4Gfat4UB9T+6dDXFu6vPtd+00cfySEFYx8W3XobbrYRtKro3Mv0dtILID93UcB6K61bI8xFGr2uQXNiFzlnkAYlaW6yxlZoh1NlbTNBaMstyq1VqYiAn+8fqn76v/RPItSgTgCKQVKyoDtgOFntDyVhTxkPW/FIu8GRXF2B06x6ugP+udBupIm4ci4/HModOb0beL0V7CZc6yItallUl9BDVsBp7Rw57nArjvEXKUrlhRiLUR953B8feJP/7jSViwXMTLKGJHTx7FTw5BB8DHcY5quNqcv5qOe/2L46+zvWR3uPrVL0C00fERrIzmsTO8DMeDgbcTHKyU2b8GnwY+DYE1hBlL3JD4IVSAF+AwCDwXY4qpBxkxLsGZ/wx+4P8z+MPnp4xBv3PEawi7RKksFtmyVrvAI6GUVF10VZi5YbafEnNI24eBvTcC/6oW6PESRhgAN5lewdhmuob6II7Tevzx+DdLuYWW7QgAAA=="
    }
  },

  //  SetDesiredState Lambda Log
  IndexAWSLogs3: {
    "awslogs": {
      "data": "H4sIAAAAAAAAAO1ZC2/bNhD+K4I3IBsa2yQlkqIwDHAaNy2WtFnsrtviwKUlKtYsi55EJfEC//edHnacJm4TNN0aNAFiSDzqHt/dR/Kky8ZUZZk8Vf35TDW8xm6n3xkedHu9zl63sd3Q54lKYZgKyrnArnAEguFYn+6lOp+BpC3Ps3Ysp6NAtnvK7KosSlXQM9KoamLPpEpOYSZBmLURbWO7ffz9fqff7fVPMA9DR/nEtrnjqICMEOUjMgoVHynb4RRUZPko89NoZiKdvIhio9Ks4R039kuTlfLhqyRQF513vX19mjVOSrPdM5WYYuZlIwrAuk0YEYIK7lKECbMFZbbtYgK3iGLmcPh3McRpC465zSgmjo2QCx6YCDAycgrhYofZmLsIVCC+vcQO1Pf6naO+daT+zmHqq8CzAupICGHUxIK6TYwVa0rqkqa0sSzsSh/71m8QDITlWTUeg6Sx2P48h8UdHb4cNMbGzJpTZcY6GDQ8a9A4fAMuNLbhyqgLU43FKngWxjIbk0oiZ1FzouaVcDkZUhDVOvpI9H7fe/fL3pos0FMZJZUcTEbaXOlaPocvjJiccRpFlSzPVNqUabJuSBU5rQaOlK+iMxV0q6FSm+/rPDErjVd6Vs69LZzr/slQJfPHMklUvBI/R7s7fxw6+79W4kznqa+a0aySUqdFkGgRG7eI4657ebpyqxdLfzLSxsItZP3wrEA489ptCLSVFaKWr6ftVMOM7MdKQ6pqMzNpxpWSdsc3OfBnV51FvnqR6mmpdi2eRE5VnZ58Ns9VUoO9zHsNaZl7LoRoIfgT4krDOkIrD5YwsEkUT+waAwPRVcOztKiT6omyzFcPFLXOlKDrtc58uA1trjDHIK+rx5dxfN36MgdXIZ26rqzj0RNVF0BXPn+dhNPzvSTZJ120M2bP+52XLK29VGkB1SqR2LaJ62DHpnTQWHw+qzD6tlhV1tsTtZ6o9R9QC39b1DqCbf7RM0sak0aj3KgV5F+YcUkex7cRLCi1rop7Fn0NvDuTcV4bWC/Ex0FHcnc6Fsm4FswSfigP6Y+nxQG8kB1fFtk0cT0RugQTJadWULUKVlb0CjVEOtY1lOdAJZj1Ibs9PVPJMIxiNQx1HKjUs4alAm9o3SarjXjDwSAZeufybD4MICXel7ocVg5P00lwngyrNeR4GUAhCSMVBwDLyfpNhVE21mkZpklz9UEhvX//vuifmghK0O4T4hHkIeA04hxTEC45s0J5lUMP6mLb+rT6qlRvUwX0LpRUHkO1j0r+bkylB8YGJc0grYNiYnlfz1kbuWJ4OVb8bo6xkG6Xc+KlkuK3JhhcLRaLpZM10yofv7ti2dpy3FNJ0Nf1UnQ7bwQwixHMkE2QzYAIWCAGbSrjgiHugFwQQWwmBOe2s7Hvoty9K29g2ZrpJKsFevLEpic2PQo27WlTUuloVcAPQCm6sem6Sam66gsoVtBUdx8c3D8CSRlUrILrO/dicevK0XnX2xCkC4Ew4bgQgwv7KSOEIpcJjF2HuwRTQgQnGMGWSwkWhG8IkhDs/H9BQkIhwqt03lydLvOtmZzHWgZbnvUTnA21r1PVWk5qVW/moJx3dDC39Ogv5RtLGgtd8NBl1B0JJTD6edvaWlo5UEYG0kjQd7n1st8/LF4i5tlzHSgYIgiVc+sXbDCyFYa+HwifNcNRyJqO7ePmSLlhk6FAhIFDRtglW2UdP0CeNr0I/JrydFgl5Hq6hrPl6E0XrqKoD8Zf1O+z6m1nIRIAa7my1zn/tNXNri/WTH5k1qJy4tuu4k2nlFuq+D6n+7WTxqletlTXN7eq/7PGMrMyZa7vcVaW+z7YDqHLm9/YMO/x5AMe/1xi2w5nBFEqGIVuj2GXOgy2LNi0COGwVyGGoGUqdiNMNrVNsJ2xBz/+PTq473g+KDAHbAmADj0qcVwO8MKxgLmQCBekgLtNqAPdru0KSjdjfu180H29e98vMw/gHbujd0fdwzf3/3Q0MLt5Kk358QhzglqUWNNsYHaiGJZCa00IJkFiDcyBmup0bvWif+BQiYlrHezAoLywasHbDE6mFqHleAHAyeJfehKfqh4cAAA="
    }
  },

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
function runTest() {
  const path = require('path');
  const script = path.basename(__filename).replace('.js', '');
  return exports.handler(test_input[script], test_context, (err, result) => {
    if (err) console.error(JSON.stringify(err, null, 2));
    else console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  });
}

if (!isProduction()) runTest();
