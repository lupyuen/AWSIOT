'use strict';

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
    
    function handler(event, context, callback) {
        //  This is the main function logic.
        console.log({event});
        const table = 'g88_sensor_data';
        //  Connect to the MySQL database.
        return mysql.createConnection({
            host     : 'tpiotdb.culga9y9tfvw.us-west-2.rds.amazonaws.com',
            user     : 'root',
            password : '<<YOURPASSWORD>>',
            database : 'g88'
        })
        .then(conn => {
            if (false) return conn.query('insert into ?? set ?', [table, {
                timestamp: new Date(),
                sensor: 'temperature',
                number: 27.1
            }]);
            return conn.query('select * from ??', [table]);
        })
        .then(res => {
            const rows = res[0];
            const fields = res[1];
            const result = rows.length > 0 ? rows[0] : null;
            console.log({a:6, result});
            return callback(null, result);
        })
        .catch(err => {
            console.error({handler: err});
            return callback(err);
        });
    }
    
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
