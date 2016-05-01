//  Send IoT sensor data to Sumo Logic and Slack for searching and dashboards
//  Node.js 4.3 / index.handler / lambda_basic_execution / 512 MB / 1 min / No VPC
//  This AWS Lambda function accepts a JSON input of sensor values and sends them to Sumo Logic
//  search engine for indexing.  It also sends to AWS CloudWatch and posts a message to Slack.  The input looks like:
//  {"temperature":84,"timestampText":"2015-10-11T09:18:51.604Z","version":139,
//  "xTopic":"$aws/things/g88pi/shadow/update/accepted","xClientToken":"myAwsClientId-0"}

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

'use strict';
console.log('Loading function');

//  List of device names and the replacement Slack channels for the device.
//  Used if the channel name is already taken up.  Sync this with ActuateDeviceFromSlack and SetDesiredState.
const replaceSlackChannels = {
    'g88': 'g88a'
};

//  This Sumo Logic Collector URL is unique to us.
const url = 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/ZaVnC4dhaV1GcreDc3eEvTVZ-eIA52tdPZpDMpqwc5Ltz0mYLfbzlWIVLuj2k7y16fCgoAz4XLEPYB30PGZSC3QWnnH-3HlZgUqtuSwMfZ-GTPFdf9K5vg==';

const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

//  Init the AWS connection.
let AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';
//AWS.config.logger = process.stdout;  //  Debug
let cloudwatch = new AWS.CloudWatch();

exports.handler = (input, context, callback) => {
    console.log('IndexSensorData Input:', JSON.stringify(input));
    console.log('IndexSensorData Context:', JSON.stringify(context));
    //  Format the sensor data into an Elasticache update request.
    let extractedFields = {};
    let action = '';
    let device = 'Unknown';
    //  Get the device name.
    if (input.device)
        device = input.device;
    else if (input.topic) {
        //  We split the topic to get the device name.  The topic looks like "$aws/things/g0_temperature_sensor/shadow/update/accepted"
        let topicArray = input.topic.split('/');
        if (topicArray.length >= 3) {
            device = topicArray[2];
            console.log(`device=${device}`);
        }
    }
    else
        extractedFields.device = device;
    //  Copy the keys and values and send to CloudWatch.
    let actionCount = 0;
    let sensorData = {};
    for (let key in input) {
        let value = input[key];
        extractedFields[key] = value;
        if (action.length > 0)
            action = action + ', ';
        action = action + key + ': ' + value;
        actionCount++;
        sensorData[key] = value;
        //  If the value is numeric, send the metric to CloudWatch.
        if (key != 'version' && !isNaN(value))
            writeMetricToCloudWatch(device, key, value);
    }
    //  Don't index response to set desired state.
    if (actionCount == 2) return callback(null, 'Ignoring response to set desired state');
    if (!extractedFields.action) extractedFields.action = action;
    if (!extractedFields.event) extractedFields.event = 'IndexSensorData';
    if (!extractedFields.topicname && extractedFields.xTopic)
        extractedFields.topicname = extractedFields.xTopic;
    let awslogsData = {
        logGroup: device,
        logStream: device,
        logEvents: [{
            id: context.awsRequestId,
            timestamp: 1 * (new Date()),
            message: JSON.stringify(input),
            extractedFields: extractedFields
        }]};
    console.log('IndexSensorData awslogsData:', JSON.stringify(awslogsData));
    //  Transform the input to JSON messages for indexing.
    let records = transformLog(awslogsData);
    //  Skip control messages.
    if (!records) return callback(null, 'Received a control message');
    const tags = device;
    //  Post JSON messages to Sumo Logic.
    postSensorDataToSumoLogic(records, tags, (error, result) => {
        if (error) {
            console.error('IndexSensorData Error: ', JSON.stringify(error, null, 2));
            //if (failedItems && failedItems.length > 0)
                //console.log('Failed Items: ', JSON.stringify(failedItems, null, 2));
            return callback(error);
        }
        console.log('IndexSensorData Success: ', JSON.stringify(result));
        //  Post a Slack message to the private group of the same name e.g. g88.
        return postSensorDataToSlack(device, sensorData, () => {
            return callback(null, result);
        });
    });
};

function transformLog(payload) {
    //  Transform the log into Sumo Logic format.
    if (payload.messageType === 'CONTROL_MESSAGE') return null;
    let bulkRequestBody = '';
    payload.logEvents.forEach(function(logEvent) {
        //  logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
        //  We extract the fields.
        parseIoTFields(logEvent);
        let timestamp = new Date(1 * logEvent.timestamp);
        let source = buildSource(logEvent.message, logEvent.extractedFields);
        source['id'] = logEvent.id;
        source['timestamp'] = new Date(1 * logEvent.timestamp).toISOString();
        bulkRequestBody += JSON.stringify(source) + '\n';
    });
    return bulkRequestBody;
}

function postSensorDataToSumoLogic(body, tags, callback) {
    //  Post the sensor data logs to Sumo Logic via HTTPS.
    /*
    let body = '';
    logs.forEach((rec) => {
        let log = rec.split('\n').join(' ');
        log = shiftFields(log);
        //console.log('***' + shiftFields(log) + '***');
        body += log + '\n';
    });
    */
    //  Change timestamp to Sumo Logic format: "timestamp":"2016-02-08T00:19:14.325Z" -->
    //    "timestamp":"2016-02-08T00:19:14.325+0000"
    body = body.replace(/("timestamp":"[^"]+)Z"/g, '$1+0000"');
    console.log('postSensorDataToSumoLogic: body=', body);  ////
    const url_split = url.split('/', 4);
    const host = url_split[2];
    const path = url.substr(url.indexOf(host) + host.length);
    let request_params = {
        host: host,
        method: 'POST',
        path: path,
        body: body,
        headers: {
            'Content-Type': 'text/plain',
            'Content-Length': Buffer.byteLength(body),
            'X-Sumo-Name': tags || 'Logger'
        }
    };
    let request = https.request(request_params, (response) => {
        let response_body = '';
        response.on('data', (chunk) => {
            response_body += chunk;
        });
        response.on('end', () => {
            if (response.statusCode < 200 || response.statusCode > 299) {
                console.error(response.body);
                return callback(new Error(response_body));
            }
            return callback(null, response_body);
        });
    }).on('error', (e) => {
        console.error(e);
        return callback(e);
    });
    //  Make the request and wait for callback.
    request.end(request_params.body);
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

function buildSource(message, extractedFields) {
    if (extractedFields) {
        let source = {};
        for (let key in extractedFields) {
            if (extractedFields.hasOwnProperty(key) && extractedFields[key]) {
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
    // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    // We extract the fields.  Do the same for logevent.extractedFields.event.  Also we remove "TRACEID:", "PRINCIPALID:", "EVENT:" from the existing fields.
    //console.log("parseIoTFields logEvent=", JSON.stringify(logEvent, null, 2));
    let fields = logEvent.extractedFields;
    if (fields.traceid) fields.traceid = fields.traceid.replace('TRACEID:', '');
    if (fields.principalid) fields.principalid = fields.principalid.replace('PRINCIPALID:', '');
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
}

function parseIoTData(fields, data) {
    // data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    // We extract the fields and populate into the "fields" collection.
    let pos = 0;
    let lastPos = -1;
    let lastFieldName = null;
    for (;;) {
        let match = matchIoTField(data, pos);
        if (match.pos < 0) break;
        if (lastPos < 0) {
            //  First iteration.
            lastPos = 0;
            pos = match.pos + 1;
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
    //  event contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    //  We return the next position on or after pos that matches an IoT field (e.g. "EVENT:"), and return the field name.
    if (pos >= data.length) return { pos: -1, fieldName: '' };
    let fieldNames = [
        'Action',
        'CLIENTID',
        'EVENT',
        'Matching rule found',
        'MESSAGE',
        'Message arrived on',
        'Message Id',
        'IndexSensorData awslogsData',
        'IndexSensorData Context',
        'IndexSensorData Input',
        'IndexSensorData logEvent',
        'IndexSensorData Response',
        'IndexSensorData Success',
        'Status',
        'Target Arn',
        'THINGNAME',
        'TOPICNAME'
    ];
    let matchPos = -1;
    let matchFieldName = null;
    fieldNames.forEach(function(fieldName) {
        let fieldPos = data.toLowerCase().indexOf(fieldName.toLowerCase() + ':', pos);
        if (fieldPos < 0) return;
        if (matchPos < 0 || fieldPos < matchPos) {
            matchPos = fieldPos;
            matchFieldName = fieldName;
        }
    });
    return {
        pos: matchPos,
        fieldName: matchFieldName
    };
}

function postSensorDataToSlack(device, sensorData, callback) {
    //  Post the sensor values to a Slack group for the device e.g. g88.
    //  device is assumed to begin with the group name. sensorData contains
    //  the sensor values.
    if (!device) return;
    let channel = '';
    let pos = device.indexOf('_');
    if (pos > 0)
        channel = device.substring(0, pos);
    //http://d3gc5unrxwbvlo.cloudfront.net/_plugin/kibana/#/discover/Sensor-Data?_g=(refreshInterval:(display:'10%20seconds',section:1,value:10000),time:(from:now-1d,mode:quick,to:now))&_a=(query:(query_string:(analyze_wildcard:!t,query:'%%CHANNEL%%*')))'
    let url = 'http://sumologic.com';  //  TODO
    url = url.split('%%CHANNEL%%').join(channel);
    //  Clone a copy.
    let sensorData2 = JSON.parse(JSON.stringify(sensorData));
    //  Combine the less important fields.
    let otherFields = '';
    if (sensorData2.timestampText) {
        otherFields = otherFields + ' - ' + sensorData2.timestampText.substr(0, 19);
        delete sensorData2.timestampText;
    }
    if (sensorData2.xTopic) {
        otherFields = otherFields + ' - ' + sensorData2.xTopic;
        delete sensorData2.xTopic;
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
    postToSlack(device, [attachment], callback);
}

function postToSlack(device, textOrAttachments, callback) {
    //  Post a Slack message to the private group of the same name e.g. g88.
    //  device is assumed to begin with the group name. text is the text
    //  message, attachments is the Slack rich text format.
    if (!device) return;
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
        path: '/services/T09SXGWKG/B0EM7LDD3/o7BGhWDlrqVtnMlbdSkqisoS',
        method: 'POST'
    };
    console.log('Slack request =', JSON.stringify(body));
    let req = https.request(options, (res) => {
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
            return callback(null, body);
        });
    });
    req.on('error', (e) => {
        console.error(e);
        return callback(e);
    });
    req.write(JSON.stringify(body));
    req.end();
}

function extractJson(message) {
    //  If the message contains a JSON string, return the JSON.
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
    return fieldName.toLowerCase().split(' ').join('_');
}

function isProduction() {
    //  Return true if this is production server.
    if (process.env.LAMBDA_TASK_ROOT) return true;
    var environment = process.env.NODE_ENV || 'development';
    return environment !== 'development';
}

//  Unit test cases.
const test_input = {
    "led": "off",
    "distance": 5,
    "lot_is_occupied": 1,
    "temperature": 37.5,
    "light_level": 90,
    "sound_level": 100,
    "humidity": 54,
    "timestampText": "2016-04-30T01:19:34.774045",
    "version": 5498,
    "xTopic": "$aws/things/g88_pi/shadow/update/accepted"
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
    return exports.handler(test_input, test_context, function(err, result) {
        if (err) console.error(err);
        else console.output(result);
    });
}

if (!isProduction()) runTest();

/*
//  Promises Example for AWS
function poll(functionName, callback) {
    const params = {
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 10
    };
    // batch request messages
    SQS.receiveMessage(params, (err, data) => {
        if (err) {
            return callback(err);
        }
        // for each message, reinvoke the function
        const promises = data.Messages.map((message) => {
            const payload = {
                operation: PROCESS_MESSAGE,
                message: message
            };
            const params = {
                FunctionName: functionName,
                InvocationType: 'Event',
                Payload: new Buffer(JSON.stringify(payload))
            };
            return new Promise((resolve, reject) => {
                Lambda.invoke(params, (err) => err ? reject(err) : resolve());
            });
        });
        // complete when all invocations have been made
        Promise.all(promises).then(() => {
            const result = `Messages received: ${data.Messages.length}`;
            console.log(result);
            callback(null, result);
        });
    });
}

var https = require('https');
var async = require('async');
var CircularJSON = require('circular-json');
var chalk = require('chalk'); chalk.enabled = true;
var yaml = require('js-yaml');
var stringifier = require('stringifier');
var typeName = require('type-name');

function Logger (tags, buffer) {
    //  Tags contains a comma-delimited list of tags.
    this.tags = tags.join(',') || 'Logger';
    //  Define the buffer count, unless one has already been defined.
    this.buffer = buffer || 10;
    this._buffer = [];
}

Logger.prototype.write = function(rec, callback) {
    if (!process.env.LAMBDA_TASK_ROOT && typeof rec !== 'object' && !Array.isArray(rec)) {
        throw new Error('Logger requires a raw stream. Please define the type as raw when setting up the bunyan stream.');
    }
    if (typeof rec === 'object') {
        //  loggly prefers timestamp over time.
        if (rec.time !== undefined) {
            rec.timestamp = rec.time;
            delete rec.time;
        }
        //  Stringify the object but not too many fields or Loggly will stop indexing the extra fields.
        //  All fields beyond a certain depth will be serialised as YAML.
        if (rec.msg && rec.msg.timestamp) rec = rec.msg;  //  Get the inner message.
        if (typeof rec === 'object') {
            var log = { body: rec };
            transformLog(log);
            rec = log.storage;
        }
    }
    //  rec is now a string.  Write to our array buffer.
    this._buffer.push(rec);
    //  Check the buffer, we may or may not need to send to loggly.
    return this.checkBuffer(false, callback);
};

Logger.prototype.checkBuffer = function (end_of_input, callback) {
    if (this._buffer.length === 0) {
        if (callback) return callback(null);
        return;
    }
    //  In case of exception, we flush the buffer right away.
    var last_rec = this._buffer[this._buffer.length - 1];
    if (!end_of_input && last_rec.indexOf('"exception":') < 0 && last_rec.indexOf('"error":') < 0 &&
        this._buffer.length < this.buffer) {
        if (callback) return callback(null);
        return;
    }
    //  Duplicate the array, because it could be modified before our HTTP call succeeds.
    var content = this._buffer.slice();
    this._buffer = [];
    sendToLoggly(content, this.tags, function(err, response) {
        if (err) console.error('Logger Error:', err);
        console.log('Logger:', response);
        if (callback) return callback(err, response);
    });
};

module.exports = {
    Logger: Logger,
    transformLog: transformLog
};

var strategies = stringifier.strategies;
var prev_default_handler = strategies.object();
//noinspection JSUnusedGlobalSymbols
var display_options = {
    indent: isProduction() ? null : '  ',
    anonymous: '',  //  Suppress the 'Object' constructor.
    typeFun: function(val) {  //  Return empty type name to suppress the 'Object' constructor.
        var t = typeName(val);
        if (t === 'Object' || t.indexOf('Error') >= 0 || t.indexOf('Exception') >= 0) return '';
        return t;
    },
    handlers: {
        '@default': defaultHandler,  //  Hook on to the default handler so we can prune ourselves.
        function: strategies.always('"#function#"'),  // Needed because the default JSON parser can't parse #function#.
        undefined: strategies.always('null')  //  Needed because the default JSON parser can't parse undefined.
    }
};
var stringify = stringifier(display_options);

function transformLog(log) {
    //  Transform the logs for better display and storage.
    try {
        var body = log.body;  if (!body) {
            console.error('Logger/transformLog', 'Log body is missing');
            return; }
        log.storage = body; log.display = body; log.error = body;
        if (log.setEncoding) log.freeze = true;  //  This is a response object from unit test.
        //  Shift the important fields to the front.
        var body2 = {};
        if (!log.freeze) body2.action = body.action ? body.action : null;
        body2.status = body.status ? body.status : null;
        if (!log.freeze) body2.duration = body.duration ? body.duration : 0.0;
        for (var key in body) { if (!body2[key]) body2[key] = body[key]; }

        var body_stringified = null;
        if (log.freeze) body_stringified = CircularJSON.stringify(body2, null, 2);
        else {
            //  "storage": Prune the log so we don't exceed 500 fields for Loggly.
            //  Store the pruned items as YAML.
            //  TODO: Return only first 20 entries for arrays.
            body_stringified = stringify(body2);
            log.storage = body_stringified;
        }
        if (isProduction()) log.display = body_stringified;
        else {
            //  "display": For console display, show in colour YAML.
            body_stringified = body_stringified.split('\\n').join('\n');  //  Restore line breaks in the YAML text.
            var pos = 0, pos2 = 0, pos3 = 0;
            if (!log.freeze) {
                pos = body_stringified.indexOf(':');  if (pos < 0) pos = 0;
                pos2 = body_stringified.indexOf('/', pos);  if (pos2 < 0) pos2 = pos;
                pos3 = body_stringified.indexOf(',', pos2);  if (pos3 < 0) pos3 = pos2;
            }
            var tail = body_stringified.substring(pos3).split('\n');
            //  Get the rightmost column number of the colon.
            var maxColonPos = 1;
            for (var i = 0; i < tail.length; i++) {
                var tail2 = tail[i];
                var colon2 = tail2.indexOf(':');
                if (colon2 > maxColonPos) maxColonPos = colon2;
            }
            log.display =
                chalk.gray('\n') +
                chalk.gray(body_stringified.substring(0, pos)) + //  action:
                chalk.yellow(body_stringified.substring(pos, pos2)) +  //  action1
                chalk.green(body_stringified.substring(pos2, pos3)) +  //  / action2
                transformTail(log, tail, maxColonPos);
            chalk.gray.reset('\n');
        }
        //  "error": Send YAML error logs by email.
        return log.display;
    }
    catch (err) {
        console.error('Logger/transformLog', err);
    }
}

function transformTail(log, tail, maxColonPos) {
    var row_count = 0;
    return tail.map(function (line) {
        if (!log.freeze && line.length >= 1 && line[line.length - 1] == ',')
            line = line.substr(0, line.length - 1);  //  Remove trailing comma.
        var colon = line.indexOf(':');
        if (colon <= 0) return chalk.cyan(line);

        var left = line.substring(0, colon + 1);
        var right = line.substring(colon + 1).trim();
        //  Remove surrounding quotes.
        if (!log.freeze) {
            left = left.split('"').join('');
            right = removeQuotes(right);
        }
        var align_width = maxColonPos - left.length + 1;
        if (align_width < 1) align_width = 1;
        if (log.freeze) align_width += 3;
        var align = new Array(align_width).join(' ');
        if (right === '{' || right === '[') align = ' ';  //  Don't leave "{" dangling at right.
        else if (right === '"') right = '';

        var left_color = chalk.cyan;
        var right_color = chalk.white;
        row_count++;
        if (row_count % 2 === 0) { right_color = chalk.gray; left_color = chalk.white; }  //  Alternate row colors.
        if (right.toLowerCase().indexOf('success') >= 0) { left_color = chalk.green; right_color = chalk.green; }  //  Alternate row colors.
        else if (right === 'error') { left_color = chalk.red; right_color = chalk.red; }  //  Errors.
        else if (right === 'null' || right === 'undefined' || right === '0' || right === '(unknown)')
            right_color = chalk.blue;  //  Hide the nulls.

        return left_color(left) +
            align +  //  Align the colons with spaces.
            right_color(right);
    }).join('\n');
}

function defaultHandler(acc, val, c, d, e, f) {
    //  Handle the JSON stringify of a JSON object, called by the stringifier.
    //  We prune beyond a certain level and embed the YAML string for the pruned items instead.
    //  c through f are not used, but we pass them for future upgrades.
    try {
        //  Prune objects whose keys are numeric, because Loggly can only index up to 500 field names.
        var force_prune = false;
        if (typeof val === 'object') {
            var keys = Object.keys(val);
            if (keys && keys[0] && keys[0][0] >= '0' && keys[0][0] <= '9')
                force_prune = true;
        }
        var prune_levels = 2;  //  Levels after this are pruned.
        if (!force_prune)
            if (!acc || !acc.context || acc.context.level < prune_levels) {
                //  Not deep enough, don't prune.
                var result = prev_default_handler(acc, val, c, d, e, f);
                //  Override the "pre" handler so we can output the key in quotes, i.e. "key": val
                //  This is needed because Loggly won't interpret the log as JSON unless the keys are in quotes.
                acc.context.pre(function writeObjectKey(val2, key) {
                    //  Original code from stringifier/strategies.js:
                    //    beforeEachChild(this, acc.push, acc.options);
                    //    acc.push(sanitizeKey(key) + (acc.options.indent ? ': ' : ':'));
                    //  We changed to output the quotes.
                    try {
                        beforeEachChild(this, acc.push, acc.options);
                        var key2 = sanitizeKey(key);
                        if (key2[0] != '"') key2 = '"' + key2 + '"';
                        acc.push(key2 + ':');
                    }
                    catch (err2) { console.error('Logger/defaultHandler2', err2); }
                });
                return result;
            }
        //  For the deep levels, convert to YAML and dump out as string.
        var text = yaml.safeDump(val, { skipInvalid: true });
        text = '\\n ^ ' + text.split('"').join('\\"')  //  Convert the quotes.
                .split('\n').join('\\n ^ ');  //  Prefix all lines by caret so we can restore line breaks later.
        acc.push('"' + text + '"');
        //  Copy from stringifier/strategies.js -> end(). Need this so that the caller will skip to the end.
        acc.context.keys = [];
        var END = {};
        return END;
    }
    catch (err) { console.error('Logger/defaultHandler', err); }
}

function shiftFields(log) {
    //  Shift the fields in the JSON log record such that action, status, duration appear in front.
    if (log[0] != '{') return log;
    var log2 = shiftField(log, 'duration');
    var log3 = shiftField(log2, 'status');
    var log4 = shiftField(log3, 'action');
    return log4;
}

function shiftField(log, field) {
    //  Shift the field in the log record to the front.
    if (log[0] != '{' || log[1] != '"') return log;
    var name = '"' + field + '":';
    var pos = log.indexOf(name);
    if (pos < 1) return log;

    var before_field = log.substr(1, pos - 1);
    var value = log.substr(pos + name.length);
    var marker = ',';  //  Numeric value.
    if (value[0] == '"') marker = ',';  //  String value
    else if (value[0] == '[') marker = '],';  //  Array value
    pos = value.indexOf(marker);
    if (pos < 1) return log;
    var after_field = value.substr(pos + marker.length);
    value = value.substr(0, pos + marker.length);

    if (value.indexOf('\\') >= 0) return log;  //  Too complex to handle.
    var spacer = '';
    //  If this is a top-level action invoked by the user, return less space.
    if (field === 'action') spacer = getSpacerForAction(value);
    else spacer = '';
    var log2 = '{' + name.substr(0, name.length - 1) + spacer + ':' + spacer +
        value + spacer + before_field + after_field;
    return log2;
}

function getSpacerForAction(action) {
    //  If this is a top-level action invoked by the user, return less space.
    //  action="cart/add"
    if (!action) return '';
    if (action[0] === '"') action = action.substr(1);
    var action_split = action.split('/');
    var module = action_split[0];
    var func = action_split[1];
    if (module === 'cart' || module === 'loyalty' || module === 'menu' || module === 'orders' ||
        module === 'outlets' || module === 'receipts' || module === 'users') {
        //  Func name must not have uppercase letters.
        for (var i = 0; i < func.length; i++) {
            if (func[i] >= 'A' && func[i] <= 'Z') return ' ';
        }
        return '';
    }
    return '';
}

function removeQuotes(s) {
    //  Remove surrounding quotes.
    if (s.length < 2) return s;
    if ((s[0] === '"' || s[0] === '\'') &&
        s[0] == s[s.length - 1]) {
        s = s.substr(1, s.length - 2);
    }
    return s;
}

function beforeEachChild (context, push, options) {
    //  Copied from stringifier/strategies.js.
    if (options.indent) {
        push(options.lineSeparator);
        for(var i = 0; i <= context.level; i += 1) {
            push(options.indent);
        }
    }
}

function sanitizeKey (key) {
    //  Copied from stringifier/strategies.js.
    return /^[A-Za-z_]+$/.test(key) ? key : JSON.stringify(key);
}

function isProduction() {
    //  Return true if this is production server.
    if (process.env.LAMBDA_TASK_ROOT) return true;
    var environment = process.env.NODE_ENV || 'development';
    return environment !== 'development';
}

*/