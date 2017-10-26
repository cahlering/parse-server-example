'use strict';

const className = "ReminderConfig";
const ReminderConfigObject = Parse.Object.extend(className);

exports.getExistingReminderCount = function() {
    let existingCheck = new Parse.Query(ReminderConfigObject);
    return existingCheck.count();
};

exports.getLastReminderTime = function() {
    let reminderConfigQuery = new Parse.Query(ReminderConfigObject);
    return reminderConfigQuery.descending("requestedTime").first();
};

exports.recordReminder = function() {
    return new ReminderConfigObject({requestedTime:moment().toDate()}).save();
};

exports.initializeReminderConfig = function() {
    return new ReminderConfigObject(
        {requestedTime:moment().subtract(12, 'hours').toDate()})
        .save();
};
