//  When used in an AWS IoT rule, this lambda function appends the sensor values to a CSV file hosted in AWS S3 cloud storage.
//  For example, this sensor data input:
//    { "timestamp": "2016-01-28 01:01:01", "temperature": 37.1 }
//  will generate a CSV file like:
//    timestamp,temperature
//    ...
//    "2016-01-28 01:01:01",37.1
//
//  This demonstrates a simple CSV integration with Geckoboard dashboards.
//  Beware: This function should not be called by multiple callers at the same 
//  time, because the file updates are not protected against concurrent updates
//  and may corrupt the file.
//  Adapted from http://stackoverflow.com/questions/34056133/append-string-to-a-text-file-nodejs-in-aws-lambda

console.log('Loading function');

var aws = require('aws-sdk');
var s3 = new aws.S3({ apiVersion: '2006-03-01' });

exports.handler = function(event, context) {
    //  The input to this lambda function is a list of sensor data names and values, e.g.
    //  { "temperature": 37.1, "timestamp": "2016-01-28 01:01:01" }
    console.log('Received event:', JSON.stringify(event, null, 2));

    //  We will append the sensor data to these files hosted in AWS S3 cloud storage.
    //  The "complete" file contains all sensor data, the "latest" file contains the
    //  latest 120 rows of data.
    var bucket = 'sensor-data-csv';
    var complete_key = 'sensor_data_complete_01.csv';
    var latest_key = 'sensor_data_latest_01.csv';
    var params = {
        Bucket: bucket,
        Key: complete_key
    };
    console.log('Reading S3 file', params);
    s3.getObject(params, function(err, data) {
        //  This will contain the existing data in the current file.
        var existing_data = null;
        //  This will contain a list of field names for the existing data.
        var existing_fields = null;
        if (err) {
            //  File does not exist.  We create a new file.
            existing_data = [];
            existing_fields = [];
        } else {
            //  Convert body (file contents) to a string so we can process.
            var body = data.Body.toString('utf-8');
            //  Convert the existing data into Javascript's native format for easier manipulation.
            var result = parseExistingFile(body);
            existing_data = result.data;
            existing_fields = result.fields;
        }
        //  Append the sensor data.  If the field names have changed, cater for the new fields.
        appendSensorData(event, existing_data, existing_fields);
        console.log({existing_data:existing_data,existing_fields:existing_fields});
        //  Write the latest 120 values to the "latest" S3 CSV file. 
        return writeCSVFile({ Bucket: bucket, Key: latest_key }, existing_data, 
            existing_fields, 120, function (err) {
            //  Ignore the error and continue.
            //  Write the complete data to the "complete" S3 CSV file.
            return writeCSVFile({ Bucket: bucket, Key: complete_key }, existing_data, 
                existing_fields, -1, function (err2, result) {
                    if (err) return context.fail(err);
                    else if (err2) return context.fail(err2);
                    return context.succeed(result);
            });
        });
    });
};

function parseExistingFile(body) {
    //  Convert the existing data into Javascript's native dictionary format for easier manipulation.
    //  Look for the first newline.  The first line contains the list of fields.
    //  body looks like:
    //    timestamp,temperature
    //    ...
    //    "2016-01-28 01:01:01",37.1
    var newline_pos = body.indexOf('\n');
    if (newline_pos < 0) return console.error('Invalid CSV file, does not contain a newline');
    //  Break the first line (e.g. timestamp,temperature) into fields by looking for commas.
    var sensor_fields = body.substr(0, newline_pos).split(',');
    body = body.substr(newline_pos + 1);
    var sensor_data = [];
    var row_count = 2;
    //  Read the sensor data line by line into sensor_data, an array of dictionaries.
    //  Each line looks like "2016-01-28 01:01:01",37.1
    for (;;) {
        //  Stop if we have no more lines to process.
        if (body.length === 0) break;
        newline_pos = body.indexOf('\n');
        var line = null;
        if (newline_pos < 0) {
            //  If we can't find a newline, must be last line.  Parse the last line.
            line = body;
            body = '';
        }
        else {
            //  Not the last line.  Extract the line before the newline and continue.
            line = body.substr(0, newline_pos);
            body = body.substr(newline_pos + 1);
        }
        //  Transform into ["2016-01-28 01:01:01",37.1] then parse into an array.
        var line_array = JSON.parse('[' + line + ']');
        if (line_array.length != sensor_fields.length) {
            var err = 'Expecting ' + sensor_fields.length + ' fields but found ' +
                line_array.length + ' fields at row ' + row_count;
            return console.error(err);
        }
        //  Convert the array into a dictionary and remember it.
        var line_dict = {};
        for (var i = 0; i < sensor_fields.length; i++) {
            var field = sensor_fields[i];
            var value = line_array[i];
            line_dict[field] = value;
        }
        //  Accumulate the rows into an array of sensor data.
        sensor_data.push(line_dict);
        row_count++;
    }
    var result = { data: sensor_data, fields: sensor_fields };
    return result;
}

function appendSensorData(event, sensor_data, sensor_fields) {
    //  Append the sensor data in "event".  If the field names have changed, 
    //  add the new fields.
    //  Append the sensor data.
    sensor_data.push(event);
    var new_data = JSON.parse(JSON.stringify(event));  //  Make a copy of event.
    //  Match each field in the new sensor data with the existing data.
    for (var new_sensor_field in new_data) {
        for (var i = 0; i < sensor_fields.length; i++) {
            var existing_sensor_field = sensor_fields[i];
            if (new_sensor_field == existing_sensor_field) {
                //  Found a match.  Remove it from new_data.
                delete new_data[new_sensor_field];
                break;
            }
        }
    }
    //  Any field remaining in new_data must be new fields.
    for (var remaining_field in new_data) {
        sensor_fields.push(remaining_field);
    }
    console.log({sensor_data:sensor_data,sensor_fields:sensor_fields});
}

function writeCSVFile(params, sensor_data, sensor_fields, lines_to_write, callback) {
    //  Write the sensor data and fields to the S3 CSV file indicated in params.
    //  context is the lambda context that we use to indicate to AWS whether
    //  our function failed or succeeded.  lines_to_write is the number of latest data
    //  rows to be written, excluding the header line.  If negative, write all lines.
    var body = sensor_fields.join(',') + '\n';
    var start_row = 0;
    //  Compute the starting row to write, based on the number of lines to be written.
    if (lines_to_write >= 0 && lines_to_write < sensor_data.length)
        start_row = sensor_data.length - lines_to_write;
    for (var i = start_row; i < sensor_data.length; i++) {
        //  Write out all rows into a string buffer, delimited by newlines.
        //  sensor_row contains a dictionary of sensor data e.g. 
        //  { "temperature": 37.1, "timestamp": "2016-01-28 01:01:01" }
        var sensor_row = sensor_data[i];
        var output_row = '';
        for (var f = 0; f < sensor_fields.length; f++) {
            //  Write out all the columns, according to the field names, delimited by comma.
            var sensor_field = sensor_fields[f];
            var sensor_value = sensor_row[sensor_field];
            if (output_row.length > 0) output_row += ',';
            //  If the row does not contain this field, write a blank value.
            if (!sensor_value) sensor_value = '';
            //  Add the field value to the row.  JSON.stringify will surround
            //  the field value with quotes if it's a string.
            output_row += JSON.stringify(sensor_value);
        }
        //  Append the row of sensor data to the new file contents.
        body += output_row + '\n';
    }
    //  Write the CSV file to S3.
    var write_params = {
        Bucket: params.Bucket,
        Key: params.Key,
        Body: body
    };
    console.log('Writing S3 file', write_params);
    return s3.putObject(write_params, function(err, data) {
        if (err) {
            //  We have encountered an error.  Maybe due to concurrency?
            console.log('Unable to write S3 file', write_params, err);
            return callback(err);
        }
        //  The file was updated successfully.
        var result = { total_rows: sensor_data.length, 
            total_fields: sensor_fields.length };
        return callback(null, result);
    });
}
