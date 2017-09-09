'use strict'

let moment = require("./moment-timezone-with-data.js");

const className = "ReminderConfig";
const ReminderConfigObject = Parse.Object.extend(className);

let existingCheck = new Parse.Query(ReminderConfigObject);
existingCheck.count().then(function(reminderCt) {
    console.log("Reminders sent previously: " + reminderCt);

    if (reminderCt == 0) {
        console.log("New ReminderConfig");
        return new ReminderConfigObject(
            {requestedTime:moment().subtract(12, 'hours').toDate()})
            .save();
    }
}).then(function(reminderConfig) {
    if (reminderConfig !== undefined) {
        console.log("Seeded reminder: " + reminderConfig.id);
    }
}, function(err) {
    console.log(err);
});

exports.getLastReminderTime = function() {
    let reminderConfigQuery = new Parse.Query(ReminderConfigObject);
    return reminderConfigQuery.descending("requestedTime").first();
};

exports.recordReminder = function() {
    return new ReminderConfigObject({requestedTime:moment().toDate()}).save();
};
