/**
 * Created by cahlering on 6/6/14.
 */

var utils = require("./utils.js");
var cluster = require("./Cluster.js");
var pushNotify = require("./Push.js");
var _ = require("underscore");
var moment = require("./moment-timezone-with-data.js");
let reminderConfig = require("./ReminderConfig.js");

var className = "ImageMedia";
var PhotoUploadObject = Parse.Object.extend(className);

var uniqueKeyColumns = ["deviceId", "filePath"];

exports.ClassObject = PhotoUploadObject;

var subClassName = "ImagePathStore";
var PathStoreObject = Parse.Object.extend(subClassName);

const TAKEN_TIMESTAMP_FIELD = "dateImageTakenTs";
const REMIND_DATE_FIELD = "reminderDate";
const REMIND_SET_FIELD = "reminderSetDate";

Parse.Cloud.beforeSave(className, function(request, response) {
  if (request.object.get("location") == null) {
    var inLatitude = request.object.get("latitude");
    var inLongitude = request.object.get("longitude");
    var photoGeoPoint = new Parse.GeoPoint({latitude: inLatitude, longitude: inLongitude});
    request.object.set("location", photoGeoPoint);
  }

  var user = request.user;
  if (request.user && request.object.get("user") == null) {
    request.object.set("user", request.user);
  }
  if (request.object.get(TAKEN_TIMESTAMP_FIELD)) {
    var fsDateTaken = request.object.get(TAKEN_TIMESTAMP_FIELD);
    var dateTaken = new Date(fsDateTaken);
    if (!isFinite(dateTaken) || dateTaken.getYear() > (new Date()).getFullYear() + 1) {
      console.log("invalid date");
      fsDateTaken = fsDateTaken / 1000;
      dateTaken = new Date(fsDateTaken);
      if (isFinite(dateTaken)) {
        request.object.set(TAKEN_TIMESTAMP_FIELD, fsDateTaken);
      }
    }
  }
  if (!request.object.get("deviceId")) {
    response.error("please provide a deviceId");
  } else if (request.object.id != null) {
    response.success();
  } else {

    var existingQuery = new Parse.Query(PhotoUploadObject);
    _.each(uniqueKeyColumns, function(column) {
      existingQuery.equalTo(column, request.object.get(column));
    });

    //It seems as though we may not be able to block duplicates 100% of the time if they may be created near
    //simultaneously.
    existingQuery.first({
      success: function(ct) {
        if (ct === undefined) {
          response.success();
        } else {
          console.log("Found duplicate: " + ct.id);
          response.error("Duplicate: " + JSON.stringify(request.object));
        }
      },
      error: function(error) {
        console.log(error);
        response.error(error);
      }
    });
  }
});

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
                    exports.checkFlashback(deviceId, lookbackNum, lookbackPeriod).count().then(
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
    var query = exports.checkReminder();
    var reminds = [];
    query.each(function (remindPhoto) {
        var deviceId = remindPhoto.get("deviceId");
        var reminderSet = remindPhoto.get(REMIND_SET_FIELD);
        var remindMsg;
        if (reminderSet) {
          var remindRequested = moment(reminderSet);
          remindMsg = "You asked us to remind you of a moment on " + reminderSet.format("MMMM Do YYYY, h:mm:ss a") + ".  You can see this moment in your \"Reminders and Flashback\" stream for the next 24 hours. Enjoy!";
        } else {
          remindMsg = "You asked us to remind you of a moment.  You can see this moment in your \"Reminders and Flashback\" stream for the next 24 hours. Enjoy!";
        }
        reminds.push(pushNotify.sendPushToDevice(deviceId, remindMsg, "remind"));
        return Parse.Promise.when(flashes);
    }, {useMasterKey: true}).then(function () {
        response.success();
    }, function (error) {
        console.log("ReminderError: " + error);
        response.error(error.message);
    });
}

//Expose this as an endpoint to be run by kronus, temporize
Parse.Cloud.define("runFlashback", flashbackQuery);

Parse.Cloud.define("runRemind", remindQuery);

var redisUrl = process.env.REDISCLOUD_URL || process.env.REDISTOGO_URL;

function updatePrimaryCluster(uploadObject) {
  var location = uploadObject.get("location");
  var primaryCluster = uploadObject.get("primaryCluster");
  if (primaryCluster == null && location != null) {
    console.log("search for cluster for " + uploadObject.id);
    return cluster.clusterForDeviceNearLocation(uploadObject.get("deviceId"), location, uploadObject).then(function (cluster) {
      var mediaRelation = cluster.relation("media");
      mediaRelation.add(uploadObject);
      cluster.save();
      uploadObject.set("primaryCluster", cluster);
      return uploadObject.save();
    });
  } else {
    return Parse.Promise.as(uploadObject);
  }
}

exports.updatePrimaryCluster = updatePrimaryCluster;

function getPhotoUploadQueryForDevice(deviceId) {
  var userQueryObject = new Parse.Query(PhotoUploadObject);

  userQueryObject.equalTo("deviceId", deviceId);
  return userQueryObject;
}

exports.getPhotoUploadQueryForDevice = getPhotoUploadQueryForDevice;


function getUnclusteredForDeviceQuery(deviceId) {
  return getPhotoUploadQueryForDevice(deviceId).doesNotExist("primaryCluster");
}
exports.getUnclusteredForDeviceQuery = getUnclusteredForDeviceQuery;

exports.getItemsNearLocation = function(deviceId, lat, lng, radiusInKilometers, resultProcessor) {
  var searchOrigin = new Parse.GeoPoint(lat, lng);

  var sponsoredIndex = 1;
  var sponsored = getSponsoredContent();

  var localQuery = getPhotoUploadQueryForDevice(deviceId);
  localQuery.withinKilometers("location", searchOrigin,radiusInKilometers);
  localQuery.limit(50);

  localQuery.find({
    success: function(results) {
      if (sponsored){
        results.splice(sponsoredIndex, 0, sponsored);
      }
      resultProcessor(results);
    }
  });

};

function getSponsoredContent() {
  return undefined;
}

exports.getItemsForDeviceSortedByCreated = function(deviceId) {

  var eventQueryStop = moment().subtract(12, 'hours');
  var localQuery = getPhotoUploadQueryForDevice(deviceId);
  //localQuery.greaterThan("createdAt", eventQueryStop);
  localQuery.descending("createdAt");

  return localQuery.find();
};

exports.getItemsForDeviceSortedByDateTaken = function(deviceId) {

  var localQuery = getPhotoUploadQueryForDevice(deviceId);
  localQuery.descending(TAKEN_TIMESTAMP_FIELD);

  return localQuery.find();
};

/**
 *
 * @param deviceId
 * @returns {Parse.Promise} collection representing the contents of the user's clusters
 */
exports.getClusterBag = function(deviceId) {

  return cluster.clusterForDevice(deviceId).then(function(clusterResults) {

    var mixResults = [];

    _.each(clusterResults, function (clusterResult) {

      var mediaRelation = clusterResult.relation("media");
      mixResults.push(mediaRelation.query().find());
    });
    return Parse.Promise.when.apply(this, mixResults);
  });

};

function clusterUnclusteredForDevice(deviceId) {
  var uploadQuery = getUnclusteredForDeviceQuery(deviceId);
  var clusterLocations = [];
  var secondaryUpdates = [];
  return uploadQuery.find().then(function(unclusteredSet) {
    var mediaPromises = [];
    _.each(unclusteredSet, function (unclustered) {
      var ucLocation = unclustered.get("location");

      // Look at the location of the media object, and if it is in
      // range of one of the clusters we've created, skip it for now.
      // Without this, clusters are created in parallel, one for each
      // media object.
      var matchingLocation = _.find(clusterLocations, function (existingLocation) {
        return ucLocation.kilometersTo(existingLocation) < cluster.CLUSTER_THESHOLD;
      });
      if (matchingLocation == undefined) {
        mediaPromises.push(updatePrimaryCluster(unclustered));
        clusterLocations.push(ucLocation);
      } else {
        // save to update once the initial wave is complete
        secondaryUpdates.push(unclustered);
      }
    });
    return Parse.Promise.when(mediaPromises);
  }).then(function(clusteredMedia) {
    //Now, update all the unclustered items that we passed over. They should
    // all get assigned to existing clusters.
    var secondaryMediaPromises = [];
    _.each(secondaryUpdates, function(imageMedia) {
      secondaryMediaPromises.push(updatePrimaryCluster(imageMedia));
    });
    _.each(clusteredMedia, function(imageMedia) {
      secondaryMediaPromises.push(Parse.Promise.as(imageMedia));
    });
    return Parse.Promise.when(secondaryMediaPromises);
  });
}
exports.clusterUnclusteredForDevice = clusterUnclusteredForDevice;

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

Parse.Cloud.define("selfie", function(request, response) {

  var localQuery = getPhotoUploadQueryForDevice(request.params.deviceId);

  localQuery.equalTo("selfie", true);

  localQuery.find({
    success: function(results) {
      response.success(results);
    }
  });

});

Parse.Cloud.define("allpaths", function(request, response) {
  //
  getPhotoUploadQueryForDevice(request.params.deviceId).count().then(function(ct) {
    if (ct < 10000){
      var pathPromises = [];
      for (var i = 0; i < ct; i+=1000) {
        pathPromises.push(getPhotoUploadQueryForDevice(request.params.deviceId).limit(1000).skip(i).find());
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
});

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
  var flashBackQuery = exports.checkFlashback(deviceId, lookbackNum, lookbackPeriod);
  var reminderQuery = exports.checkReminderByDevice(deviceId);
  Parse.Query.or(flashBackQuery, reminderQuery).find().then(function(imgs){
    response.success(imgs);
  });
});

exports.checkFlashback = function(deviceId, lookbackNum, lookbackPeriod) {
  var lookbackStart = moment().subtract(lookbackNum, lookbackPeriod).startOf("day").valueOf();
  var lookbackEnd = moment().subtract(lookbackNum, lookbackPeriod).endOf("day").valueOf();
  console.log("Flashback from " + lookbackStart + " to " + lookbackEnd);
  return getPhotoUploadQueryForDevice(deviceId).greaterThan(TAKEN_TIMESTAMP_FIELD, lookbackStart).lessThan(TAKEN_TIMESTAMP_FIELD, lookbackEnd);
};

Parse.Cloud.define("remind", function(request, response) {
  var deviceId = request.params.deviceId;
  exports.checkReminderByDevice(deviceId).find().then(function(imgs){
    response.success(imgs);
  });
});

exports.checkReminder = function() {
    var reminderDateStart = reminderConfig.getLastReminderTime();
    var reminderDateEnd = moment({});
    console.log("Reminders from " + reminderDateStart + " to " + reminderDateEnd);
    return new Parse.Query(PhotoUploadObject).greaterThan(REMIND_DATE_FIELD, reminderDateStart).lessThan(REMIND_DATE_FIELD, reminderDateEnd);
};

exports.checkReminderByDevice = function(deviceId) {
    var reminderDateStart = moment().startOf("day").toDate();
    var reminderDateEnd = moment().endOf("day").toDate();
    console.log("Reminders for " + deviceId + " from " + reminderDateStart + " to " + reminderDateEnd);
    return getPhotoUploadQueryForDevice(deviceId).greaterThan(REMIND_DATE_FIELD, reminderDateStart).lessThan(REMIND_DATE_FIELD, reminderDateEnd);
};

