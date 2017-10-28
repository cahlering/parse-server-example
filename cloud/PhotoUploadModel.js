/**
 * Created by cahlering on 6/6/14.
 */
'use strict';


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


exports.checkFlashback = function(deviceId, lookbackNum, lookbackPeriod) {
  var lookbackStart = moment().subtract(lookbackNum, lookbackPeriod).startOf("day").valueOf();
  var lookbackEnd = moment().subtract(lookbackNum, lookbackPeriod).endOf("day").valueOf();
  console.log("Flashback from " + lookbackStart + " to " + lookbackEnd);
  return getPhotoUploadQueryForDevice(deviceId).greaterThan(TAKEN_TIMESTAMP_FIELD, lookbackStart).lessThan(TAKEN_TIMESTAMP_FIELD, lookbackEnd);
};

exports.checkReminder = function() {
    return reminderConfig.getLastReminderTime().then(function(lastReminder) {
        if (lastReminder == null) {
            return Parse.Promise.as({});
        }
        let reminderDateStart = lastReminder.get("requestedTime").getTime();
        let reminderDateEnd = new Date().getTime();
        console.log("Reminders from " + reminderDateStart + " to " + reminderDateEnd);
        return new Parse.Query(PhotoUploadObject).greaterThan(REMIND_DATE_FIELD, reminderDateStart).lessThan(REMIND_DATE_FIELD, reminderDateEnd).find({useMasterKey:true});
    });
};

exports.checkReminderByDevice = function(deviceId) {
    var reminderDateStart = moment().startOf("day").toDate().getTime();
    var reminderDateEnd = moment().endOf("day").toDate().getTime();
    console.log("Reminders for " + deviceId + " from " + reminderDateStart + " to " + reminderDateEnd);
    return getPhotoUploadQueryForDevice(deviceId).greaterThan(REMIND_DATE_FIELD, reminderDateStart).lessThan(REMIND_DATE_FIELD, reminderDateEnd);
};

exports.getSelfiesForDevice = function(deviceId) {
    return getPhotoUploadQueryForDevice(deviceId).equalTo("selfie", true).find();
};

exports.markFlashed = function (photoIds, doneFunction) {
    var flashedObjects = [];
    _.each(photoIds, function (id) {
        flashedObjects.push(new Parse.Query(PhotoUploadObject).equalTo("objectId", id).first());
    });
    Parse.Promise.when(flashedObjects).then(function (triggered) {
        var savedTriggers = [];
        _.each(triggered, function (obj) {
            //savedTriggers.push(obj.set("reminderTriggered", false).save());
        });
        return Parse.Promise.when(savedTriggers);
    }).then(function (saved) {
        doneFunction();
    }, function (err) {
        console.log(err);
    });
};


