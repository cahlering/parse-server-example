// Example express application adding the parse-server module to expose Parse
// compatible API routes.

var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var ParseDashboard = require('parse-dashboard');
var path = require('path');

var databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;

if (!databaseUri) {
    console.log('DATABASE_URI not specified, falling back to localhost.');
}

var pushObject = {};
if (process.env.PUSH_SENDER_ID) {
    pushObject.android = {
        senderId: process.env.PUSH_SENDER_ID,
        apiKey: process.env.PUSH_API_KEY
    }
}
var api = new ParseServer({
    databaseURI: databaseUri || 'mongodb://localhost:27017/dev',
    cloud: process.env.CLOUD_CODE_MAIN || __dirname + '/cloud/main.js',
    appId: process.env.APP_ID || 'myAppId',
    masterKey: process.env.MASTER_KEY || 'MASTER_KEY', //Add your master key here. Keep it secret!
    serverURL: process.env.SERVER_URL || 'http://localhost:1337/parse',  // Don't forget to change to https if needed
    liveQuery: {
        classNames: ["Posts", "Comments"] // List of classes to support for query subscriptions
    },
    push: pushObject,
    loggerAdapter: {
        module: "parse-server/lib/Adapters/Logger/WinstonLoggerAdapter",
        options: {
            logLevel: "error",
        }
    },
});
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

var allowInsecureHTTP = false;

var dashboard = new ParseDashboard({
    "apps": [{
        appId: process.env.APP_ID || 'myAppId',
        masterKey: process.env.MASTER_KEY || 'MASTER_KEY', //Add your master key here. Keep it secret!
        serverURL: process.env.SERVER_URL || 'http://localhost:1337/parse',  // Don't forget to change to https if needed
        "appName": "Goobzy"
    }],
    "users":[{
        "user":"admin",
        "pass": process.env.DASHBOARD_BCRYPT_PASS || "$2y$10$wBcdv9NvkHZ6l21N.dOD1OJCkJq7i9d2Mh8LI7F4DEAzSm.dxXiTS"
    }],
    "useEncryptedPasswords": true,
    "trustProxy": 1
}, allowInsecureHTTP);


var app = express();

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));


// make the Parse Dashboard available at /dashboard
app.use('/dashboard', dashboard);

// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
    res.status(200).send('I dream of being a website.  Please star the parse-server repo on GitHub!');
});

// There will be a test page available on the /test path of your server url
// Remove this before launching your app
app.get('/test', function(req, res) {
    res.sendFile(path.join(__dirname, '/public/test.html'));
});

var port = process.env.PORT || 1337;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('parse-server-example running on port ' + port + '.');
});

// This will enable the Live Query real-time server
ParseServer.createLiveQueryServer(httpServer);

var redisUrl = process.env.REDISCLOUD_URL || process.env.REDISTOGO_URL;
var kue = require("kue");
if (redisUrl) {
    var rtg   = require("url").parse(redisUrl);
    //var redisOptions = {
    //  host: rtg.hostname,
    //  port: rtg.port,
    //  auth: rtg.auth.split(":")[1]
    //};
    kue.createQueue({
        redis: redisUrl
        //skipConfig: true //this was required for Redis To Go to work, hopefully not so for Heroku Redis
    });
} else {
    console.log("using local redis (from kue)");
    kue.createQueue();
}

app.use('/queue', kue.app);

if (process.env.IS_MASTER) {
    var CloudCode = require('./cloud/CloudCode');
    var cloud = new CloudCode(Parse, 'America/Los_Angeles');
    cloud.putJob("runRemind", null);  // parse cloud function name & param
    cloud.addCron("runRemind", "0 */1 * * * *"); // per 1 minute
    cloud.start();
}