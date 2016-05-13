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

'use strict';
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

exports.handler = (input, context, callback) => {
    console.log('IndexSensorData Input:', JSON.stringify(input));
    console.log('IndexSensorData Context:', JSON.stringify(context));

    if (input.awslogs) {
        //  Index the AWS Logs.  Decode input from base64.
        //  This Sumo Logic Collector URL is unique to us: AWS IoT Logs
        const url = 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/ZaVnC4dhaV1GcreDc3eEvTVZ-eIA52tdPZpDMpqwc5Ltz0mYLfbzlWIVLuj2k7y16fCgoAz4XLEPYB30PGZSC3QWnnH-3HlZgUqtuSwMfZ-GTPFdf9K5vg==';
        let zippedInput = new Buffer(input.awslogs.data, 'base64');
        //  Decompress the input
        zlib.gunzip(zippedInput, (e, buffer) => {
            if (e) {
                console.error(e);
                return callback(e);
            }
            var awslogsData = JSON.parse(buffer.toString('ascii'));
            return processLogs(url, 'aws', awslogsData, callback);
        });
    }
    else {
        //  Index the sensor data.
        //  This Sumo Logic Collector URL is unique to us: Sensor Data Logs
        const url = 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/ZaVnC4dhaV2spqT2JdXJBek02aporY-ujTTn2eTcc3XfNomF_U94P6-YIpFZ6FIyAJqG9rNtzNK0JmP13upzBiH8FUfaSMyQmXqgfMdfSGazF6czrBHHxw==';
        const ret = processSensorData(input, context);
        const device = ret.device;
        const actionCount = ret.actionCount;
        const awslogsData = ret.awslogsData;
        //  Don't index response to set desired state.
        if (actionCount == 2) return callback(null, 'Ignoring response to set desired state');
        return processLogs(url, device, awslogsData, callback);
    }
};

function processLogs(url, tags, awslogsData, callback) {
    //  Transform the input to JSON messages for indexing.
    let records = transformLog(awslogsData);
    //  Skip control messages.
    if (!records) return callback(null, 'Received a control message');
    //  Post JSON messages to Sumo Logic.
    postLogsToSumoLogic(url, records, tags, (error, result) => {
        if (error) {
            console.error('IndexSensorData Error: ', JSON.stringify(error, null, 2));
            //if (failedItems && failedItems.length > 0)
            //console.log('Failed Items: ', JSON.stringify(failedItems, null, 2));
            return callback(error);
        }
        console.log('IndexSensorData Success: ', JSON.stringify(result));
        return callback(null, result);
    });
}

function getDevice(input) {
    //  Get the device name.
    let device = 'Unknown';
    if (input.device)
        device = input.device;
    else if (input.topic) {
        //  We split the topic to get the device name.  The topic looks like "$aws/things/g88pi/shadow/update/accepted"
        let topicArray = input.topic.split('/');
        if (topicArray.length >= 3) {
            device = topicArray[2];
            console.log(`device=${device}`);
        }
    }
    return device;
}

function processSensorData(input, context) {
    //  Format the sensor data into a Sumo Logic update request.
    let extractedFields = {};
    let action = '';
    let device = getDevice(input);
    extractedFields.device = device;
    //  If sensor data is located in the field "reported", move them up to top level.
    if (input.reported) {
        for (let key in input.reported)
            input[key] = input.reported[key];
        delete input.reported;
    }
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
            writeMetricToCloudWatch(device, key, value);
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
    postSensorDataToSlack(device, sensorData, () => {
        //return callback(null, result);
    });
    return {device: device, actionCount: actionCount, awslogsData: awslogsData};
}

function transformLog(payload) {
    //  Transform the log into Sumo Logic format.
    if (payload.messageType === 'CONTROL_MESSAGE') return null;
    let bulkRequestBody = '';
    payload.logEvents.forEach(function(logEvent) {
        if (!logEvent.extractedFields) logEvent.extractedFields = {};
        //  Timestamp must be first field or Sumo Logic may pick another field.
        let timestamp = new Date(1 * logEvent.timestamp);
        logEvent.extractedFields.timestamp = timestamp.toISOString();
        //  logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
        //  We extract the fields.
        parseIoTFields(logEvent);
        let source = buildSource(logEvent.message, logEvent.extractedFields);
        //source['id'] = logEvent.id;  //  Ignore ID because it is very long.
        console.log(`transformLog: ${logEvent.message} =>\n${JSON.stringify(source, null, 2)}`);  ////
        bulkRequestBody += JSON.stringify(source) + '\n';
    });
    return bulkRequestBody;
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
    // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g88pi/shadow/update THINGNAME:g88pi"
    // We extract the fields.  Do the same for logevent.extractedFields.event.  Also we remove "TRACEID:", "PRINCIPALID:", "EVENT:" from the existing fields.
    //console.log("parseIoTFields logEvent=", JSON.stringify(logEvent, null, 2));
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
    'TRACEID': 'traceId'
};

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

function postLogsToSumoLogic(url, body, tags, callback) {
    //  Post the sensor data logs to Sumo Logic via HTTPS.
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

//  Map group name to the search results for the group (search results -> share):
//  e.g. g88 -> https://service.us2.sumologic.com/ui/#section/search/w3E1OOZlQuGFikPAy45ejRSyY8Q7KyUenQAMwr8h
//           -> g88pi AND _sourceCategory=sensor | json auto "device", "temperature", "humidity", "light_level", "sound_level"
const search_by_group = {
    g88pi: 'https://service.us2.sumologic.com/ui/#section/search/w3E1OOZlQuGFikPAy45ejRSyY8Q7KyUenQAMwr8h',
    g41pi: 'https://service.us2.sumologic.com/ui/#section/search/0MjlwG9w5SwXLdKwZ6ljcfLclX6aCJ8xLYG8LypB',
    g42pi: 'https://service.us2.sumologic.com/ui/#section/search/9GRXc4aQOFJfpwYzp7A64ziFFoEAaGSP0VPbTHxq',
    g43pi: 'https://service.us2.sumologic.com/ui/#section/search/hjrxNTwNMqS1vITSARVxW1ZirEItJT7hK0FBW9qD',
    g44pi: 'https://service.us2.sumologic.com/ui/#section/search/UuS6ZcWUUP2bNX4PFFUVLws592hgyi0M1Dgq36zg',
    g45pi: 'https://service.us2.sumologic.com/ui/#section/search/lg81oOIg4oTmdy8TldKpXyIROdxlHX20hr33q8DI',
    g46pi: 'https://service.us2.sumologic.com/ui/#section/search/PYb6UR20hLg4NLN6Gf6AWbS2bXiLUiq60XiI4MUo',
    g47pi: 'https://service.us2.sumologic.com/ui/#section/search/gs308eTeSCOl3ZYcC5cUWQ4COXau9WYtdcltQ84z',
    g48pi: 'https://service.us2.sumologic.com/ui/#section/search/JjmJHj6rIlZaNxXpI2RH16dHla8vqSbfjAOwbLD3',
    g49pi: 'https://service.us2.sumologic.com/ui/#section/search/wGJLcAP07a73M0U2JqkgvZnziOAzMHX0nAkw8Hzx',
    g50pi: 'https://service.us2.sumologic.com/ui/#section/search/yFKkpZWdfCFkGSeHoMwKNKFd8aVoe8k1y1zJq42U',
    g51pi: 'https://service.us2.sumologic.com/ui/#section/search/WIJZT4cyxKuWfXGhz483FYHEvxWU8FNBROIybAqn',
    g52pi: 'https://service.us2.sumologic.com/ui/#section/search/40EMgkr3hyhuKQFZWgZ1f8e3mf8k4jsyI3jbMazl',
    g53pi: 'https://service.us2.sumologic.com/ui/#section/search/JunoyDMGpDI9kHcnpM15H6SYkSFQdJmyLbBslzZ9',
    g54pi: 'https://service.us2.sumologic.com/ui/#section/search/jrrfLIZ45BbdC2HD5qVE0Mbs8bkoAo30a7f8SOm0',
    g55pi: 'https://service.us2.sumologic.com/ui/#section/search/8vrWu4uQP7tRjVZRKCg1fGGukI4FYPCjZ0du8jcY',
    g56pi: 'https://service.us2.sumologic.com/ui/#section/search/R8NXsk38R0HjXgdyqTE9EB5f4r0ADxc7JlrNAaGo',
    g57pi: 'https://service.us2.sumologic.com/ui/#section/search/Yvs4HnV2jHZ6162b6Pe4sMQFmR78DqTmYEFbIGD4',
    g58pi: 'https://service.us2.sumologic.com/ui/#section/search/Oj38JZ78jSWg4ckVL8QV69aVoHxvcMUChUIuayZv',
    g59pi: 'https://service.us2.sumologic.com/ui/#section/search/nQcNr41Oe5OvNaWXAJ0mPN9fSX9xbuwvAYFqVZgq',
    g60pi: 'https://service.us2.sumologic.com/ui/#section/search/UyIEPvVSYq6PfVx8FM0qyNb6zTqVyCdTIUN1SAYB'
};

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
            return callback(null, body);
        });
    });
    req.on('error', e => {
        console.error('Slack Error', e, e.stack);
        return callback(e);
    });
    req.write(JSON.stringify(body));
    req.end();
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

function isProduction() {
    //  Return true if this is production server.
    if (process.env.LAMBDA_TASK_ROOT) return true;
    var environment = process.env.NODE_ENV || 'development';
    return environment !== 'development';
}

//  Unit test cases.
//  AWS Log
/*
 const test_input = {
 "awslogs": {
 "data": "H4sIAAAAAAAAAO2XW2/bNhTHvwph7GED7Jj3i/pkOE5nLDfYbvtQFAEtUbYwWfJEKVla9LvvUHKadK3rtgu2YJtfDPFyePg/P/IcvuttnPd25Ra3W9eLesejxejqbDKfj55Pev1eeVO4CpqFEUoZog03GJrzcvW8Kpst9IxezadlfVqufNc+rytnN2FKzKWzCpM0NXFC7BKn8VJQuxQpwSaV1FjmHKZmKTFVhqZaU6uXKUmETO2SgjnfLH1cZds6K4uTLK9d5XvR696p3SwT2y10NS0S9zs40XrwpnVhcu2KOox818sS8IRRiRWVDEtCNGGcUUEU1UYwRgmWmCjCpWCEc0m5lJJryjmlHDyoM5CnthvYKYyhBFzl3BDSv5MNzFNM5ACLAaYIs4ipiPIjGIIWs9F4Mj2OklTFBms3ENiwAYddDyymeJCkwjChY4wThy5n0/Px9HJ0ChP+qnLo9fT85OINQpOXk/NFdNks88yvW1XQ4uJyOj4fnU2iH+yNH9brrFj54UrrbTb0a5uUN8Nmm9jaoR0Ed9OnBZrXtm58hOYvxmPo7L3vfyqwxAILxQn8EcwEfCsOu8SEUG64AvmZoJJoRQk1ewVm+KDADD81gS+ab5B3aOPYbWuX/FnnYOUrhKYBWEM54xr+Fedcc0wE1VoRhg0VPIzl1EAINN0rtFIHhVbqyQh9Zus4KDprcndSNkXyPXqPT6dgC5wrhvaD+HeWUQWmURpsRwjMXFUuLqvkyrvCl9UVWLKfjQYEQRjNjOQUU2I4UM6YBqEJ4I85J5RobLAy4STsjYYWB6OhxX83GurKxsVXRiTc7IrA7c5Bc8oxptIwYyAMVBM4HZIxySQcIEmx3nfTC5j25YiIIxjyZCJyfFvYTTmKQ76cNyCx948Wk529tMnzW7SFS6pbDHXhOEJnnUrIVlV2DUbKIkJfu2IfdT5HKGmN9tHCLnN3H/MHwe4j9LP161/c7UnmcuAicddZ7Pp3rS9t3rQzYbk+mtli5e7Hfgjyfc9u/H1oF4TsDhskK2nI5+jiWMOhxoQqwZQJFYXhcP5JuISV0HDmQylBhYQ7Ae9LcwLzA3UE0MWfTh3xL6RLf5GsB7R8DNd+WD4hrrP/CW42zz/LFSUcEgGgpCiUkBrLwA9EiAjMgClIMCwkFaEBQLmfqwNZPXD1dLJ6V87/DVxlxXX5K4zM2wVR2hTtmo9FV2e2j052diHKVRGBmajriRo/uIFoDWj08DkV3fkRtU+ZeQvMMfC4KwPHZdIiR+8tI1dVZRWhotmDEddECyY4gR/XAtIdhjoc1pQmvG+IMTK8fhg0mf3XkzAHMRLmf4yeGkZAUBL4qctJbn2dxXNnq3gtvpsnxSD2PLx7mYJLTphQ4EJdRZmE60rBM8QwopmCl4bmYu+1BEQd4gmG/JM8TWazi9kHoObn8y4mJzbLm8o9Gk3BHvTVJWS69s2HYCn43GbxEVqsXReOkPtcy9GN9eiFd9U9Cb720cfRt943G5cMqjJ3w2m5OC1Xq1Cbh09yMx69Va/GKPOoKGtkm3pdVtnbnQ+uSstqEwUn7h6hgC4s78umit2DVQu/D76QSuuyXIP1H+euChVZhEYb+xbO4vn82Q491LHHMXuGJu0eu4bRziEb1G47nqGZ+62BhRBoh1i8BNAAhaWWciAUiweWcTPACXVKJGxpaPLTY50/2GWoEKqVq9GoKr5x+733b97/AU2Sk2ZUEwAA"
 }
 };
 */

//  Sensor Data
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
    "topic": "$aws/things/g88pi/shadow/update/accepted",
    "traceId": "4fb3ed68-ec3f-42b6-a202-4207c9c55a2a"
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
        else console.log(result);
    });
}

if (!isProduction()) runTest();