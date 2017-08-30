let moment = require("./moment-timezone-with-data.js");

let className = "ReminderConfig";
let ReminderConfigObject = Parse.Object.extend(className);

let existingCheck = new Parse.Query(ReminderConfigObject);
existingCheck.count().then(function(reminderCt) {
        console.log("Reminders sent previously: " + reminderCt);
}, function(error){
    console.log("Error querying reminders");
    console.log(error);
    new ReminderConfigObject({"requestedTime":moment().subtract(12, 'hours')}).save();
}).then(function(reminderConfig) {
    console.log("Seeded reminder: " + reminderConfig.id);
});

exports.getLastReminderTime = function() {
    let reminderConfigQuery = new Parse.Query(ReminderConfigObject);
    return reminderConfigQuery.descending("requestedTime").first();
};

exports.recordReminder = function() {
    new ReminderConfigObject({"requestedTime":moment()}).save();
};

