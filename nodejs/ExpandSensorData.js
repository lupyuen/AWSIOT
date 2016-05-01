//  Send IoT sensor data to Sumo Logic and Slack for searching and dashboards
//  Node.js 4.3 / index.handler / lambda_basic_execution / 512 MB / 1 min / No VPC

'use strict';
console.log('Loading function');

//let doc = require('dynamodb-doc');
//let dynamo = new doc.DynamoDB();
let AWS = require('aws-sdk');
let docClient = new AWS.DynamoDB.DocumentClient({region: 'us-west-2'});

exports.handler = (event, context, callback) => {
    //console.log('Received event:', JSON.stringify(event, null, 2));
    event.Records.forEach((record) => {
        console.log(record.eventID);
        console.log(record.eventName);
        //console.log('DynamoDB Record: %j', record.dynamodb);

        //  Skip if this is not an Insert event.
        if (record.eventName !== 'INSERT') return console.log(`Skipping ${record.eventName} event for ${record.eventSourceARN}`);
        //  Get the table name:
        //  "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
        const source = record.eventSourceARN;
        const source_split = source.split('/');
        const table = source_split[1];

        //  Extract the fields.
        const update = record.dynamodb; if (!update) return;
        const keys = update.Keys;  if (!keys) return;
        const timestamp = getDynamoValue(keys.timestamp);  if (!timestamp) return;
        const sensor = getDynamoValue(keys.sensor);
        const image = update.NewImage;  if (!image) return;
        const payload = getDynamoValue(image.payload); if (!payload) return;
        const reported = payload.reported; if (!reported) return;

        let item = {
            timestamp: timestamp,
            sensor: sensor,
            payload: payload
        };
        //  Expand the sensor values.
        for (let name in reported) {
            const value = reported[name];
            item[name] = value;
            addRecord(table, timestamp, sensor, name, value);
        }
        //  Expand the other attributes.
        for (let name of ['reported', 'topic', 'version', 'traceId']) {
            const value = payload[name];
            if (value || value === 0 || value === 0.0) item[name] = value;
        }
        //  Update the database record.
        let params = {
            TableName : table,
            Item: item
        };
        return docClient.put(params, function(err, data) {
            if (err) console.error(`Error updating table=${table}, timestamp=${timestamp}, sensor=${sensor}: ${err}`);
            else console.log(`Updated table=${table}, timestamp=${timestamp}, sensor=${sensor}: ${data}`);
        });
    });
    //   The above database updates may still be running, AWS will wait for them to finish.
    //   Always return success, else AWS will retry.
    return callback(null, `Processing ${event.Records.length} records`);
};

function addRecord(table, timestamp, sensor, name, value) {
    //  Add a sensor data record.
    if (name === 'timestamp') return;  //  Don't record the timestamp again.
    sensor = name;
    let params = {
        TableName : table,
        Item: {
            timestamp: timestamp,
            sensor: sensor
        }
    };
    let field = 'text';
    if (typeof value === 'number') field = 'number';
    params.Item[field] = value;
    return docClient.put(params, function(err, data) {
        if (err) console.error(`Error adding table=${table}, timestamp=${timestamp}, sensor=${sensor}: ${err}`);
        else console.log(`Added table=${table}, timestamp=${timestamp}, sensor=${sensor}: ${data}`);
    });
}

function getDynamoValue(obj) {
    //  Strip off the DynamoDB atttributes and return as Javascript types.
    if (obj.M) {
        //  For Maps, recursively strip off all attributes.
        let result = {};
        for (let key in obj.M)
            result[key] = getDynamoValue(obj.M[key]);
        return result;
    }
    else if (obj.S) return obj.S;  //  String
    else if (obj.N) return parseFloat(obj.N);  //  Number
    return obj;
}

function isProduction() {
    //  Return true if this is production server.
    if (process.env.LAMBDA_TASK_ROOT) return true;
    var environment = process.env.NODE_ENV || 'development';
    return environment !== 'development';
}

//  Unit test cases.

//  Run the unit test if we are in development environment.
function runTest() {
    return exports.handler(test_input, null, function(err, result) {
        if (err) console.error(err);
        else console.output(result);
    });
}

var test_data = {
    "Keys": {
        "sensor": {
            "S": "''"
        },
        "timestamp": {
            "S": "2016-05-01T15:23:35.193623"
        }
    },
    "NewImage": {
        "payload": {
            "M": {
                "traceId": {
                    "S": "7bc5f2ae-fc5b-4f65-9c28-d019f7f03562"
                },
                "metadata": {
                    "M": {
                        "timestamp": {
                            "N": "1462087415"
                        }
                    }
                },
                "reported": {
                    "M": {
                        "light_level": {
                            "N": "782"
                        },
                        "temperature": {
                            "N": "33"
                        },
                        "humidity": {
                            "N": "45"
                        },
                        "sound_level": {
                            "N": "392"
                        },
                        "timestamp": {
                            "S": "2016-05-01T15:23:35.193623"
                        }
                    }
                },
                "topic": {
                    "S": "$aws/things/g88pi/shadow/update/accepted"
                },
                "version": {
                    "N": "1118"
                },
                "timestamp": {
                    "N": "1462087415"
                }
            }
        },
        "sensor": {
            "S": "''"
        },
        "timestamp": {
            "S": "2016-05-01T15:23:35.193623"
        }
    },
    "SequenceNumber": "4500000000002861686411",
    "SizeBytes": 344,
    "StreamViewType": "NEW_AND_OLD_IMAGES"
};

var test_input = {
    "Records": [
    {
        "eventID": "6d12319157ad2801737b779a93056006",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:12:58.115593"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "76c3e710-d031-4d35-887b-9a886705654a"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086778"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "764"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "452"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:12:58.115593"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1098"
                        },
                        "timestamp": {
                            "N": "1462086778"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:12:58.115593"
                }
            },
            "SequenceNumber": "2500000000002861608775",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "74a9fec03b08baa83cfb488acee242b6",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:13:29.946081"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "8436dc63-c8ec-47f3-83db-7e86c2708ec1"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086810"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "764"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "330"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:13:29.946081"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1099"
                        },
                        "timestamp": {
                            "N": "1462086810"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:13:29.946081"
                }
            },
            "SequenceNumber": "2600000000002861612362",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "ff60d4d2e7f11e2cef3c094dfa6eb781",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:14:01.805123"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "d58aa2c1-2777-4202-95b6-a7710df463a1"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086841"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "762"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "323"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:14:01.805123"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1100"
                        },
                        "timestamp": {
                            "N": "1462086841"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:14:01.805123"
                }
            },
            "SequenceNumber": "2700000000002861615954",
            "SizeBytes": 355,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "b3fc8df244c82d2e73338e4d967555c1",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:14:33.664861"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "f726b0de-8318-4e42-907e-1513a7401c45"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086873"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "768"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "321"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:14:33.664861"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1101"
                        },
                        "timestamp": {
                            "N": "1462086873"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:14:33.664861"
                }
            },
            "SequenceNumber": "2800000000002861619258",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "fcc0f2b005873029620d994d26244e1a",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:15:05.505404"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "4c366817-ba19-4ab9-bd3b-b13b8452552e"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086905"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "766"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "385"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:15:05.505404"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1102"
                        },
                        "timestamp": {
                            "N": "1462086905"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:15:05.505404"
                }
            },
            "SequenceNumber": "2900000000002861622516",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "e9e392eee4a7e5876650923652aa56c0",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:15:37.362447"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "8bcab617-05c7-4052-9127-9af8f07999b2"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086937"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "766"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "321"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:15:37.362447"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1103"
                        },
                        "timestamp": {
                            "N": "1462086937"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:15:37.362447"
                }
            },
            "SequenceNumber": "3000000000002861625740",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "271710092bd615e6a9d6bca0110ac18d",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:16:09.222283"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "35e333bf-d79e-4856-a406-b86e72a4e1fa"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462086969"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "770"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "46"
                                },
                                "sound_level": {
                                    "N": "321"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:16:09.222283"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1104"
                        },
                        "timestamp": {
                            "N": "1462086969"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:16:09.222283"
                }
            },
            "SequenceNumber": "3100000000002861629005",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "52f281330504af45a1451201abea2e26",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:16:41.086279"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "63aa15a2-d3b3-47f7-baa9-ac9fa21b66f8"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462087001"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "769"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "323"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:16:41.086279"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1105"
                        },
                        "timestamp": {
                            "N": "1462087001"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:16:41.086279"
                }
            },
            "SequenceNumber": "3200000000002861632483",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "b67e612eae12d13331908c42ad24b5fd",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:17:12.945103"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "200966fe-9a5a-4f4d-947e-b97b3fcb3b1c"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462087033"
                                }
                            }
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "768"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "431"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:17:12.945103"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1106"
                        },
                        "timestamp": {
                            "N": "1462087033"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:17:12.945103"
                }
            },
            "SequenceNumber": "3300000000002861636263",
            "SizeBytes": 344,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "6e31c7378f926c5c7f963ce4b2d2c062",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:17:44.806107"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "19b1a456-c262-4141-8a95-46e92c95e913"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462087064"
                                }
                            }
                        },
                        "clientId": {
                            "S": "n/a"
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "767"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "45"
                                },
                                "sound_level": {
                                    "N": "322"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:17:44.806107"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1107"
                        },
                        "timestamp": {
                            "N": "1462087064"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:17:44.806107"
                }
            },
            "SequenceNumber": "3400000000002861640406",
            "SizeBytes": 356,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "beb3e89e8327a487fa5a868406b57f8d",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:18:16.637308"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "aaa09465-909c-46dc-af66-42ef305895b8"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462087096"
                                }
                            }
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "770"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "44"
                                },
                                "sound_level": {
                                    "N": "363"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:18:16.637308"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1108"
                        },
                        "timestamp": {
                            "N": "1462087096"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:18:16.637308"
                }
            },
            "SequenceNumber": "3500000000002861644512",
            "SizeBytes": 344,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    },
    {
        "eventID": "8bc6fd688cce30015c81c807429ff17f",
        "eventName": "INSERT",
        "eventVersion": "1.0",
        "eventSource": "aws:dynamodb",
        "awsRegion": "us-west-2",
        "dynamodb": {
            "Keys": {
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:18:48.485346"
                }
            },
            "NewImage": {
                "payload": {
                    "M": {
                        "traceId": {
                            "S": "d0b419c7-0ba6-4e26-8b09-24c1ac11a11e"
                        },
                        "metadata": {
                            "M": {
                                "timestamp": {
                                    "N": "1462087128"
                                }
                            }
                        },
                        "reported": {
                            "M": {
                                "light_level": {
                                    "N": "772"
                                },
                                "temperature": {
                                    "N": "33"
                                },
                                "humidity": {
                                    "N": "44"
                                },
                                "sound_level": {
                                    "N": "429"
                                },
                                "timestamp": {
                                    "S": "2016-05-01T15:18:48.485346"
                                }
                            }
                        },
                        "topic": {
                            "S": "$aws/things/g88pi/shadow/update/accepted"
                        },
                        "version": {
                            "N": "1109"
                        },
                        "timestamp": {
                            "N": "1462087128"
                        }
                    }
                },
                "sensor": {
                    "S": "''"
                },
                "timestamp": {
                    "S": "2016-05-01T15:18:48.485346"
                }
            },
            "SequenceNumber": "3600000000002861648676",
            "SizeBytes": 344,
            "StreamViewType": "NEW_AND_OLD_IMAGES"
        },
        "eventSourceARN": "arn:aws:dynamodb:us-west-2:595779189490:table/g88_new/stream/2016-05-01T07:07:40.846"
    }
    ]
};

if (!isProduction()) runTest();

