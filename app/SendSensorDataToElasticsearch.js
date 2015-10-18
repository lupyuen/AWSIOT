//  This AWS Lambda function accepts a JSON input of sensor values and sends them to AWS Elasticache
//  seach engine for indexing.  It also sends to AWS CloudWatch.  The input looks like:
//  {"temperature":84,"timestampText":"2015-10-11T09:18:51.604Z","version":139,
//  "xTopic":"$aws/things/g0_temperature_sensor/shadow/update/accepted","xClientToken":"myAwsClientId-0"}
//  Make sure the role executing this Lambda function has CloudWatch PutMetricData and PutMetricAlarm permissions.

var https = require('https');
var zlib = require('zlib');
var crypto = require('crypto');

//  Init the AWS connection.
var AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';
AWS.config.sslEnabled = false;
AWS.config.logger = process.stdout;  //  Debug
var cloudwatch = new AWS.CloudWatch();

var endpoint = 'search-iot-74g6su3n4aupthnnhffmvewv2a.us-west-2.es.amazonaws.com';

exports.handler = function(input, context) {
    console.log("SendSensorData Input:", JSON.stringify(input));
    console.log("SendSensorData Context:", JSON.stringify(context));
    //  Format the sensor data into an Elasticache update request.
    var extractedFields = {};
    var action = "";
    var device = "Unknown";
    //  Get the device name.
    if (input.device) {
        device = input.device
    }
    else {
        if (input.xTopic) {
            //  We split the topic to get the device name.  The topic looks like "$aws/things/g0_temperature_sensor/shadow/update/accepted"
            var topicArray = input.xTopic.split("/");
            if (topicArray.length >= 3)
                device = topicArray[2];
        }
        extractedFields.device = device;
    }
    //  Copy the keys and values and send to CloudWatch.
    for (var key in input) {
        var value = input[key];
        extractedFields[key] = value;
        if (action.length > 0) 
            action = action + ", ";
        action = action + key + ": " + value;
        //  If the value is numeric, send the metric to CloudWatch.
        if (key != "version" && !isNaN(value)) {
            writeMetricToCloudWatch(device, key, value);
        }
    }
    if (!extractedFields.action)
        extractedFields.action = action;
    if (!extractedFields.event)
        extractedFields.event = "RecordSensorData";
    if (!extractedFields.topicname && extractedFields.xTopic)
        extractedFields.topicname = extractedFields.xTopic;
    var awslogsData = {
        "messageType": "DATA_MESSAGE",
        "owner": "595779189490",
        "logGroup": "AWSIotLogs",
        "logStream": "g0_temperature_sensor",
        "subscriptionFilters": [
            "ElasticsearchStream_iot"
        ],
        "logEvents": [
            {
                "id": context.awsRequestId,
                "timestamp": 1 * (new Date()),
                "message": JSON.stringify(input),
                "extractedFields": extractedFields
            }
        ]
    };
    console.log("SendSensorData awslogsData:", JSON.stringify(awslogsData));
    
    // transform the input to Elasticsearch documents
    var elasticsearchBulkData = transform(awslogsData);

    // skip control messages
    if (!elasticsearchBulkData) {
        console.log('Received a control message');
        context.succeed('Success');
    }
    
    // post documents to Amazon Elasticsearch
    post(elasticsearchBulkData, function(error, success, statusCode, failedItems) {
        console.log('SendSensorData Response: ' + JSON.stringify({ 
            "statusCode": statusCode 
        }));

        if (error) { 
            console.log('SendSensorData Error: ' + JSON.stringify(success, null, 2));

            if (failedItems && failedItems.length > 0) {
                console.log("Failed Items: " +
                    JSON.stringify(failedItems, null, 2));
            }

            context.fail(e); 
        }

        console.log('SendSensorData Success: ' + JSON.stringify(success));
        context.succeed('Success');
    });
};

function writeMetricToCloudWatch(device, metric, value) {
    //  Write the sensor data as a metric to CloudWatch.
    console.log("writeMetricToCloudWatch:", device, metric, value);
    try {
        var params = {
            MetricData: [{
              MetricName: metric,
              Timestamp: new Date(),
              Unit: 'None',
              Value: value
            }],
            Namespace: device
        };
        cloudwatch.putMetricData(params, function(err, data) {
            if (err) return console.log("putMetricData error:", err, err.stack); // an error occurred
            console.log("putMetricData: ", data);  // successful response
        });
    }
    catch(err) {
        console.log("Unable to log to CloudWatch", err);
    }
}

function transform(payload) {
    if (payload.messageType === 'CONTROL_MESSAGE') {
        return null;
    }
    
    var bulkRequestBody = '';

    payload.logEvents.forEach(function(logEvent) {
        // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
        // We extract the fields.
        parseIoTFields(logEvent);

        var timestamp = new Date(1 * logEvent.timestamp);

        // index name format: cwl-YYYY.MM.DD
        var indexName = [
            'cwl-' + timestamp.getUTCFullYear(),              // year
            ('0' + (timestamp.getUTCMonth() + 1)).slice(-2),  // month
            ('0' + timestamp.getUTCDate()).slice(-2)          // day
        ].join('.');

        var source = buildSource(logEvent.message, logEvent.extractedFields);
        source['@id'] = logEvent.id;
        source['@timestamp'] = new Date(1 * logEvent.timestamp).toISOString();
        source['@message'] = logEvent.message;
        source['@owner'] = payload.owner;
        source['@log_group'] = payload.logGroup;
        source['@log_stream'] = payload.logStream;

        var action = { "index": {} };
        action.index._index = indexName;
        action.index._type = payload.logGroup;
        action.index._id = logEvent.id;
        
        bulkRequestBody += [ 
            JSON.stringify(action), 
            JSON.stringify(source),
        ].join('\n') + '\n';
    });
    return bulkRequestBody;
}

function buildSource(message, extractedFields) {
    if (extractedFields) {
        var source = {};

        for (var key in extractedFields) {
            if (extractedFields.hasOwnProperty(key) && extractedFields[key]) {
                var value = extractedFields[key];

                if (isNumeric(value)) {
                    source[key] = 1 * value;
                    continue;
                }

                jsonSubString = extractJson(value);
                if (jsonSubString !== null) {
                    source['$' + key] = JSON.parse(jsonSubString);
                }

                source[key] = value;
            }
        }
        return source;
    }

    jsonSubString = extractJson(message);
    if (jsonSubString !== null) { 
        return JSON.parse(jsonSubString); 
    }

    return {};
}

function extractJson(message) {
    var jsonStart = message.indexOf('{');
    if (jsonStart < 0) return null;
    var jsonSubString = message.substring(jsonStart);
    return isValidJson(jsonSubString) ? jsonSubString : null;
}

function isValidJson(message) {
    try {
        JSON.parse(message);
    } catch (e) { return false; }
    return true;
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function post(body, callback) {
    var requestParams = buildRequest(endpoint, body);

    var request = https.request(requestParams, function(response) {
        var responseBody = '';
        response.on('data', function(chunk) {
            responseBody += chunk;
        });
        response.on('end', function() {
            var info = JSON.parse(responseBody);
            var failedItems;
            var success;
            
            if (response.statusCode >= 200 && response.statusCode < 299) {
                failedItems = info.items.filter(function(x) {
                    return x.index.status >= 300;
                });

                success = { 
                    "attemptedItems": info.items.length,
                    "successfulItems": info.items.length - failedItems.length,
                    "failedItems": failedItems.length
                };
            }

            var error = response.statusCode !== 200 || info.errors === true ? {
                "statusCode": response.statusCode,
                "responseBody": responseBody
            } : null;

            callback(error, success, response.statusCode, failedItems);
        });
    }).on('error', function(e) {
        callback(e);
    });
    request.end(requestParams.body);
}

function buildRequest(endpoint, body) {
    var endpointParts = endpoint.match(/^([^\.]+)\.?([^\.]*)\.?([^\.]*)\.amazonaws\.com$/);
    var region = endpointParts[2];
    var service = endpointParts[3];
    var datetime = (new Date()).toISOString().replace(/[:\-]|\.\d{3}/g, '');
    var date = datetime.substr(0, 8);
    var kDate = hmac('AWS4' + process.env.AWS_SECRET_ACCESS_KEY, date);
    var kRegion = hmac(kDate, region);
    var kService = hmac(kRegion, service);
    var kSigning = hmac(kService, 'aws4_request');
    
    var request = {
        host: endpoint,
        method: 'POST',
        path: '/_bulk',
        body: body,
        headers: { 
            'Content-Type': 'application/json',
            'Host': endpoint,
            'Content-Length': Buffer.byteLength(body),
            'X-Amz-Security-Token': process.env.AWS_SESSION_TOKEN,
            'X-Amz-Date': datetime
        }
    };

    var canonicalHeaders = Object.keys(request.headers)
        .sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; })
        .map(function(k) { return k.toLowerCase() + ':' + request.headers[k]; })
        .join('\n');

    var signedHeaders = Object.keys(request.headers)
        .map(function(k) { return k.toLowerCase(); })
        .sort()
        .join(';');

    var canonicalString = [
        request.method,
        request.path, '',
        canonicalHeaders, '',
        signedHeaders,
        hash(request.body, 'hex'),
    ].join('\n');

    var credentialString = [ date, region, service, 'aws4_request' ].join('/');

    var stringToSign = [
        'AWS4-HMAC-SHA256',
        datetime,
        credentialString,
        hash(canonicalString, 'hex')
    ] .join('\n');

    request.headers.Authorization = [
        'AWS4-HMAC-SHA256 Credential=' + process.env.AWS_ACCESS_KEY_ID + '/' + credentialString,
        'SignedHeaders=' + signedHeaders,
        'Signature=' + hmac(kSigning, stringToSign, 'hex')
    ].join(', ');

    return request;
}

function hmac(key, str, encoding) {
    return crypto.createHmac('sha256', key).update(str, 'utf8').digest(encoding);
}

function hash(str, encoding) {
    return crypto.createHash('sha256').update(str, 'utf8').digest(encoding);
}

//  Added for TP-IOT
function parseIoTFields(logEvent) {
    // logevent.extractedFields.data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    // We extract the fields.  Do the same for logevent.extractedFields.event.  Also we remove "TRACEID:", "PRINCIPALID:", "EVENT:" from the existing fields.
    //console.log("parseIoTFields logEvent=", JSON.stringify(logEvent, null, 2));
    var fields = logEvent.extractedFields;
    if (fields.traceid) fields.traceid = fields.traceid.replace("TRACEID:", "");
    if (fields.principalid) fields.principalid = fields.principalid.replace("PRINCIPALID:", "");
    //  Parse the data field.
    if (fields.data) {
        parseIoTData(fields, fields.data);
        delete fields.data;
    }
    //  Parse the event field.
    if (fields.event && fields.event.indexOf(":") > 0) {
        parseIoTData(fields, fields.event);
        delete fields.event;
    }
}

function parseIoTData(fields, data) {
    // data contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    // We extract the fields and populate into the "fields" collection.
    var pos = 0;
    var lastPos = -1;
    var lastFieldName = null;
    for (;;) {
        var match = matchIoTField(data, pos);
        if (match.pos < 0) break;
        if (lastPos < 0) {
            //  First iteration.
            lastPos = 0;
            pos = match.pos + 1;
            lastFieldName = match.fieldName;
        }
        else {
            //  Extract from lastPos to match.pos.
            var nameAndValue = data.substring(lastPos, match.pos);
            var value = nameAndValue.substr(lastFieldName.length + 1).trim();
            fields[normaliseFieldName(lastFieldName)] = value;
            lastPos = match.pos;
            lastFieldName = match.fieldName;
            pos = match.pos + 1;
        }
    }
    //  Extract the last field.
    if (lastPos >= 0) {
        var nameAndValue2 = data.substr(lastPos);
        var value2 = nameAndValue2.substr(lastFieldName.length + 1).trim();
        fields[normaliseFieldName(lastFieldName)] = value2;
    }
    return "";
}

function matchIoTField(data, pos) {
    //  event contains "EVENT:UpdateThingShadow TOPICNAME:$aws/things/g0_temperature_sensor/shadow/update THINGNAME:g0_temperature_sensor"
    //  We return the next position on or after pos that matches an IoT field (e.g. "EVENT:"), and return the field name.
    if (pos >= data.length) return { pos: -1, fieldName: "" };
    var fieldNames = [
        "Action",
        "CLIENTID",
        "EVENT",
        "Matching rule found",
        "MESSAGE",
        "Message arrived on",
        "Message Id",
        "SendSensorData awslogsData",
        "SendSensorData Context",
        "SendSensorData Input",
        "SendSensorData logEvent",
        "SendSensorData Response",
        "SendSensorData Success",
        "Status",
        "Target Arn",
        "THINGNAME",
        "TOPICNAME",
    ];
    var matchPos = -1;
    var matchFieldName = null;
    fieldNames.forEach(function(fieldName) {
        var fieldPos = data.toLowerCase().indexOf(fieldName.toLowerCase() + ":", pos);
        if (fieldPos < 0) return;
        if (matchPos < 0 || fieldPos < matchPos) {
            matchPos = fieldPos;
            matchFieldName = fieldName;
        }
    });
    var result = {
        pos: matchPos,
        fieldName: matchFieldName
    };
    //console.log("result=", result);
    return result;
}

function normaliseFieldName(fieldName) {
    //  If the field name contains spaces, change them to underscore. Make the field name lowercase.
    return fieldName.toLowerCase().split(" ").join("_");
}
