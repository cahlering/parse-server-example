/**
 * Created by cahlering on 6/6/14.
 */
'use strict';

var model = require("./PhotoUploadModel");
var utils = require("./utils.js");
var cluster = require("./Cluster.js");
var pushNotify = require("./Push.js");
var _ = require("underscore");
var moment = require("./moment-timezone-with-data.js");
let reminderConfig = require("./ReminderConfig.js");

var uniqueKeyColumns = ["deviceId", "filePath"];


var subClassName = "ImagePathStore";
var PathStoreObject = Parse.Object.extend(subClassName);

const TAKEN_TIMESTAMP_FIELD = "dateImageTakenTs";
const REMIND_DATE_FIELD = "reminderDate";
const REMIND_SET_FIELD = "reminderSetDate";

function flashbackQuery(request, response) {
    var query = new Parse.Query(Parse.Installation);
    var m = moment();
    query.each(function (install) {
        var zone = install.get("timeZone");
        var tzZone = m.tz(zone);
        if (tzZone && tzZone.hour) {
            console.log(install.id + " current hour is " + m.tz(zone).hour());
            var flashes = [];
            if (m.tz(zone).hour() == 10) {
                var deviceId = install.get("deviceId");
                var lookbackNum = install.get("lookbackNum");
                if (lookbackNum == null) lookbackNum = 6;
                var lookbackPeriod = install.get("lookbackPeriod");
                if (lookbackPeriod == null) lookbackPeriod = "month";
                flashes.push(
                    model.checkFlashback(deviceId, lookbackNum, lookbackPeriod).count().then(
                        function (flashBackCount) {
                            console.log(deviceId + " found for flashback: " + flashBackCount);
                            if (flashBackCount > 0) pushNotify.sendPushToDevice(deviceId, "Remember this day from " + lookbackNum + " " + lookbackPeriod + (flashBackCount != 1? "s": "") + " ago?", "flashback");
                        }, function (err) {
                            console.log("error counting flashback");
                            console.log(err);
                        }
                    )
                );
            }
        } else {
            console.log(install.id + " does not have a valid hour (zone: " + zone + ")");
        }
        return Parse.Promise.when(flashes);
    }, {useMasterKey: true}).then(function () {
        response.success();
    }, function (error) {
        console.log(error);
        response.error(error.message);
    });
}

function remindQuery(request, response) {
    console.log("checking reminders");
    var query = model.checkReminder();
    var reminds = [];

    query.then(function (remindPhotos) {
        _.each(remindPhotos, function(remindPhoto) {
            var deviceId = remindPhoto.get("deviceId");
            console.log("remind device: " + deviceId);
            var reminderSet = remindPhoto.get(REMIND_SET_FIELD);
            var remindMsg;
            if (reminderSet) {
                var remindRequested = moment(reminderSet);
                remindMsg = "You asked us to remind you of a moment on " + remindRequested.format("MMMM Do YYYY, h:mm:ss a") + ". See it in \"Reminders and Flashbacks\". Enjoy!";
            } else {
                remindMsg = "You asked us to remind you of a moment. See it in \"Reminders and Flashbacks\". Enjoy!";
            }
            reminds.push(pushNotify.sendPushToDevice(deviceId, remindMsg, "remind"));
            reminds.push(remindPhoto.set("reminderTriggered", true).save());
        });
        return Parse.Promise.when(reminds);
    }).then(function(remindPushes) {
        reminderConfig.recordReminder();
    }, function (error) {
        console.log("ReminderError: " + error);
    });
}

//Expose this as an endpoint to be run by kronus, temporize
Parse.Cloud.define("runFlashback", flashbackQuery);

Parse.Cloud.define("runRemind", remindQuery);

var redisUrl = process.env.REDISCLOUD_URL || process.env.REDISTOGO_URL;
var kue = require("kue"), queue = kue.createQueue({jobEvents: false, redis: redisUrl, skipConfig: true});


function getSponsoredContent() {
  return undefined;
}

Parse.Cloud.define("clusterMedia", function(request, response) {
  var deviceId = request.params.deviceId;
  clusterUnclusteredForDevice(deviceId).then(function(clusteredMedia) {
    if (clusteredMedia != null) console.log("clusteredMedia: " + clusteredMedia.length);
    response.success(clusteredMedia);
  }, function(error) {
    response.error(error);
  });

});

Parse.Cloud.define("cluster", function(request, response) {

  var ClusterObject = Parse.Object.extend("MediaCluster");
  var clusterQuery = new Parse.Query(ClusterObject);

  clusterQuery.equalTo("deviceId", request.params.deviceId);
  clusterQuery.find().then(function(clusterResults) {

    var promises = [];
    _.each(clusterResults, function (clusterResult) {
      promises.push(clusterResult.relation("media").query().find());
    });
    return Parse.Promise.when(promises);
  }).then(function(list) {
    response.success(list);
  });

});

Parse.Cloud.define("selfie", getSelfiesForDevice);

exports.getSelfiesForDevice = function(request, response) {
    model.getSelfiesForDevice(request.params.deviceId).then(function (devices) {
        response.success(devices);
    });
};

Parse.Cloud.define("allpaths", exports.getAllPaths);

exports.getAllPaths = function(request, response) {

  model.getPhotoUploadQueryForDevice(request.params.deviceId).count().then(function(ct) {
    if (ct < 10000){
      var pathPromises = [];
      for (var i = 0; i < ct; i+=1000) {
        pathPromises.push(model.getPhotoUploadQueryForDevice(request.params.deviceId).limit(1000).skip(i).find());
      }
      return Parse.Promise.when.apply(this, pathPromises);
    } else {

    }
  }).then(function() {
    var paths = [];
    _.each(arguments, function(imgSet) {
      _.each(imgSet, function(img) {
        paths.push(img.get("filePath"));
      });
    });
    response.success(paths);
  }, function(error) {
    response.error(error);
  })
};

Parse.Cloud.define("deduplicate", function(request, response) {

  getPhotoUploadQueryForDevice(request.params.deviceId).count().then(function(imgCt) {

    var queryResults = [];
    for ( var i = 0; i < imgCt; i = i + 1000) {
      var imgQuery = getPhotoUploadQueryForDevice(request.params.deviceId).limit(1000).skip(i);
      queryResults.push(imgQuery.find());
    }
    return Parse.Promise.when(queryResults);
  }).then(function(results) {

    var imgs = [];
    _.each(_.flatten(arguments), function(rs) {
      imgs.push(rs);
    });

    return imgs;
  }).then(function(imgs) {

    var imgsByDevice = _.groupBy(imgs, function(img) { return img.get('deviceId');});

    var detectedDupes = [];

    _.each(_.keys(imgsByDevice), function(deviceId){
      console.log(deviceId);
      var uImgs = imgsByDevice[deviceId];
      console.log(uImgs.length);
      var sortedByPath = _.sortBy(uImgs, function(imgByPath) {
        return imgByPath.get("filePath");
      });
      var lastImagePath = "";
      _.each(sortedByPath, function(sortedImage) {
        if (sortedImage.get("filePath").localeCompare(lastImagePath) === 0) {
          detectedDupes.push(sortedImage.destroy());
        }
        lastImagePath = sortedImage.get("filePath");
      });
    });
    return Parse.Promise.when(detectedDupes);
  }).then(function(dupes) {
    response.success(dupes);
  }, function(err) {
    response.error(err);
  });
});

Parse.Cloud.define("flashback", function(request, response) {
  var deviceId = request.params.deviceId;
  var lookbackNum = request.params.lookback;
  var lookbackPeriod = request.params.lookbackPeriod;
  var flashBackQuery = model.checkFlashback(deviceId, lookbackNum, lookbackPeriod);
  var reminderQuery = model.checkReminderByDevice(deviceId);
  Parse.Query.or(flashBackQuery, reminderQuery).find().then(function(imgs){
    var objectIds = _.pluck(imgs, 'id');

    var job = queue.create("flashed", {ids: objectIds})
      .delay(3000)
      .removeOnComplete(true)
      .save();
    queue.process("flashed", function (job, done) {
      var flashedObjects = [];
      _.each(job.data.ids, function(id) {
        flashedObjects.push(new Parse.Query(PhotoUploadObject).equalTo("objectId", id).first());
      });
      Parse.Promise.when(flashedObjects).then(function (triggered) {
        var savedTriggers = [];
        _.each(triggered, function(obj) {
          //savedTriggers.push(obj.set("reminderTriggered", false).save());
        });
        return Parse.Promise.when(savedTriggers);
      }).then(function(saved){
        done();
      }, function (err) {
          console.log(err);
      });
    });

    response.success(imgs);
  });
});

Parse.Cloud.define("remind", function(request, response) {
  var deviceId = request.params.deviceId;
  model.checkReminderByDevice(deviceId).find().then(function(imgs){
    response.success(imgs);
  });
});

