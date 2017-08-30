let moment = require("./moment-timezone-with-data.js");

let className = "ReminderConfig";
let ReminderConfigObject = Parse.Object.extend(className);

let existingCheck = new Parse.Query(ReminderConfigObject);
existingCheck.count().then(function(reminderCt) {
    if (reminderCt === 0) {
        return new ReminderConfigObject({"requestedTime":moment().subtract(12, 'hours')}).save();
    }
}).then(function(reminderConfig) {
    console.log("Seeded reminder: " + reminderConfig.id);
});

exports.getLastReminderTime = function() {
    let reminderConfigQuery = new Parse.Query(ReminderConfigObject);
    return reminderConfigQuery.descending("requestedTime").first().then(function (result) {
        return result.get("requestedTime").getTime();
    });
};

