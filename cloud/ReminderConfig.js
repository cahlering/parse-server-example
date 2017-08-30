let moment = require("./moment-timezone-with-data.js");

let className = "ReminderConfig";
let ReminderConfigObject = Parse.Object.extend(className);

let existingCheck = new Parse.Query(ReminderConfigObject);
existingCheck.count().then(function(reminderCt) {
    if (reminderCt === 0) {
        new ReminderConfigObject({"requestedTime":moment().subtract(12, 'hours')}).save();
    }
});

exports.getLastReminderTime = function() {
    let reminderConfigQuery = new Parse.Query(ReminderConfigObject);
    return reminderConfigQuery.descending("requestedTime").first().then(function (result) {
        return result.get("requestedTime");
    });
};

