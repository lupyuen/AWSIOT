//  This script allows you to use require(...) for NPM modules in AWS Lambda
//  inline scripts.  The lambda code will be relocated to /tmp because only
//  /tmp is writeable.  The NPM modules will be installed in /tmp/node_modules.

'use strict';

const tmp = '/tmp';  //  Relocate code here.
const modules = `${tmp}/node_modules`;  //  Install NPM modules here.
const taskRoot = process.env.LAMBDA_TASK_ROOT || __dirname;  //  Code is at /var/task by default.
process.env.HOME = tmp;  //  For naive processes that assume $HOME always works! You might not need this.
process.env.PATH += ':' + taskRoot;  //  On linux the executable is in task root / __dirname, whichever was defined

const exec = require('child_process').exec;

//  Catch any errors and display here.
process.on('error', err => {
    console.error({error: err});
});

process.on('uncaughtException', err => {
    console.error({uncaughtException: err});
});

process.on('unhandledRejection', (reason, promise) => {
    console.error({unhandledRejection: {reason, promise}});
});

function autorequire(handler, dirname, filename) {
  //  Wrap a lambda handler so that we relocate the code and install NPM modules
  //  when we detect a module not found error.  Else we let it run as normal.
  //  All non-system require(...) references must be contained inside the 
  //  handler, not outside.
  
  return function lambdaHandler(event, context, callback) {
    const callback2 = callback;
    const dom = require('domain').create();
    
    dom.on('error', err => {
        //  When we see a module not found error, move the script to /tmp and 
        //  fix any missing "require" modules.
        //console.error({lambdaHandler1: err});
        const filename_split = filename.split('/');
        const script = filename_split[filename_split.length - 1];
        //  Only handle missing module errors.
        if (err.code !== 'MODULE_NOT_FOUND')
            return callback(err);
            
        if (dirname.indexOf(tmp) !== 0) {
            //  If not running from /tmp, copy this script to /tmp and run from 
            //  there.  Because node_modules can only be installed in /tmp.
            let cmd = `cp ${taskRoot}/* ${tmp}`;
            cmd = `bash -c "cd ${tmp}; ls -l; ${cmd}; ls -l "`;
            console.log({copy_to_tmp: cmd});
            return runCommand(cmd)
            .then(res => {
                const script2 = `${tmp}/${script}`;
                console.log({starting_script: script2});
                const res2 = require(script2);
                ////return res2.handler(event, context, callback);
                return res2.handler(event, context, (err, res) => {
                    console.log({err, res});
                    return callback2(err, res);
                });
            })
            .catch(err => {
                console.error({lambdaHandler2: err});
                return callback(err);
            });
        }
        
        //  Else we must be running from /tmp.  Install the missing module and restart.
        const msg = err.message;  //  e.g. Cannot find module 'mysql2/promise'
        const msg_split = msg.split('\'');
        if (msg_split.length !== 3) return callback(err);
        let module = msg_split[1];
        //  For 'mysql2/promise', use 'mysql2' as module name.
        const module_split = module.split('/');
        module = module_split[0];
        console.log({install_module: module});
        
        //  Install the module.
        return installModule(module)
        .then(res => {
            //  Restart so that it will load the module.
            return handler(event, context, callback);  
        })
        .catch(err => {
            console.error({lambdaHandler3: err});
            return callback(err);
        });
    });

    dom.run(() => {
        //  At next tick, run the lambda handler.
        process.nextTick(() => {
            console.log('nextTick');
            return handler(event, context, callback);
        });
    });
  };
}

function installModule(module) {
    //  Run NPM in /tmp to install the missing module, e.g. module='mysql2'.
    let cmd = `npm install --save ${module}`;
    cmd = `bash -c "cd ${tmp}; ls -l; ${cmd}; ls -l "`;
    console.log({cmd});
    return runCommand(cmd)
    .then(res => {
        //  Load the module.
        return requireModule(module);
    })
    .catch(err => {
        console.error({installModule: err});
        throw err;
    });
}

function dumpModules() {
    //  Dump a list of all modules.
    let cmd = `ls -l ${tmp}`;
    cmd = `bash -c "${cmd}"`;
    console.log({cmd});
    return runCommand(cmd);
}

function runCommand(cmd) {
    //  Execute the command.
    return new Promise((resolve, reject) => {
        const child = exec(cmd, error => {
            //  Resolve with result of process
            if (error) return reject(error)
            return resolve(null);
        });
        // Log process stdout and stderr
        child.stdout.on('data', console.log);
        child.stderr.on('data', console.error);
    });
}

function requireModule(module) {
    //  The module has been loaded into /tmp.  Load the module.  
    //  module is named like 'mysql2/promise'.
    const mod = `${modules}/${module}`;
    console.log({mod});////
    const loaded_module = require(mod);
    return loaded_module;
}

module.exports = autorequire;
