let moment = require("./moment-timezone-with-data.js");

let className = "ReminderConfig";
let ReminderConfigObject = Parse.Object.extend(className);

let existingCheck = new Parse.Query(ReminderConfigObject);
existingCheck.count().then(function(reminderCt) {
    if (reminderCt === 0) {
        return new ReminderConfigObject({"requestedTime":moment().subtract(12, 'hours')}).save();
    } else {
        console.log("Reminders sent previously: " + reminderCt);
    }
}).then(function(reminderConfig) {
    console.log("Seeded reminder: " + reminderConfig.id);
});

exports.getLastReminderTime = function() {
    let reminderConfigQuery = new Parse.Query(ReminderConfigObject);
    let remindResult = null;
    reminderConfigQuery.descending("requestedTime").first({
        success: function(firstResult) {
            remindResult = firstResult;
        }
    });
    console.log("what?");
    console.log(remindResult);
    return remindResult.get("requestedTime");
};

