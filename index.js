var pm2 = require('pm2');

var instances = process.env.WEB_CONCURRENCY || -1; // Set by Heroku or -1 to scale to max cpu core -1
var maxMemory = process.env.WEB_MEMORY || 512;    // " " "

var slaveInstances = (instances >= 0) ? instances - 1 : -1;

pm2.connect(function() {
    pm2.start({
        script    : 'app.js',
        error_file: "logs/node-app.stderr.log",
        name      : 'goobzy-app-master',     // ----> THESE ATTRIBUTES ARE OPTIONAL:
        exec_mode : 'cluster',            // ----> https://github.com/Unitech/PM2/blob/master/ADVANCED_README.md#schema
        instances : 1,
        max_memory_restart : maxMemory + 'M',   // Auto restart if process taking more than XXmo
        env: {                            // If needed declare some environment variables
            "IS_MASTER": true
        },
    }, function(err) {
        if (err) return console.error('Error while launching applications', err.stack || err);
        console.log('PM2 and application has been succesfully started');

        // Display logs in standard output
        pm2.launchBus(function(err, bus) {
            console.log('[PM2] Log streaming started');

            bus.on('log:out', function(packet) {
                console.log('[App:%s-%d] %s', packet.process.name, process.env.pm_id, packet.data);
            });

            bus.on('log:err', function(packet) {
                console.error('[App:%s-%d][Err] %s', packet.process.name, process.env.pm_id, packet.data);
            });
        });

    });
    if (process.env.SPAWN_WORKERS) {
        pm2.start({
            script: 'app.js',
            error_file: "logs/node-app.stderr.log",
            name: 'goobzy-app-slave',     // ----> THESE ATTRIBUTES ARE OPTIONAL:
            exec_mode: 'cluster',            // ----> https://github.com/Unitech/PM2/blob/master/ADVANCED_README.md#schema
            instances: slaveInstances,
            max_memory_restart: maxMemory + 'M',   // Auto restart if process taking more than XXmo
            env: {                            // If needed declare some environment variables
                "IS_MASTER": false
            },
        }, function (err) {
            if (err) return console.error('Error while launching applications', err.stack || err);
            console.log('PM2 and application has been succesfully started');

            // Display logs in standard output
            pm2.launchBus(function (err, bus) {
                console.log('[PM2] Log streaming started');

                bus.on('log:out', function (packet) {
                    console.log('[App:%s-%d] %s', packet.process.name, process.env.pm_id, packet.data);
                });

                bus.on('log:err', function (packet) {
                    console.error('[App:%s-%d][Err] %s', packet.process.name, process.env.pm_id, packet.data);
                });
            });

        });
    }
});