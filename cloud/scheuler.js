/**
 * Created by cahlering on 10/28/17.
 */


var redisUrl = process.env.REDISCLOUD_URL || process.env.REDISTOGO_URL;
if (redisUrl) {
    var kue = require("kue"), queue = kue.createQueue({jobEvents: false, redis: redisUrl, skipConfig: true});
} else {
    queue = {
        create: function() {
            console.log("No redisUrl, dummying create call");
        },
        process: function() {
            console.log("No redisUrl, dummying process call");
        }
    }
}

exports.scheduleFlashed = function(objectIds) {
    queue.create("flashed", {ids: objectIds})
        .delay(3000)
        .removeOnComplete(true)
        .save();
};

exports.registerFlashedProcessor = function(flashed) {
    queue.process("flashed", function (job, done) {
        flashed(job.data.ids, done);
    });
};
