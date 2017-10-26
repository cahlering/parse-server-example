'use strict';

let moment = require("./moment-timezone-with-data.js");
let model = require("./ReminderConfigModel");

model.getExistingReminderCount().then(function(reminderCt) {
    console.log("Reminders sent previously: " + reminderCt);

    if (reminderCt == 0) {
        console.log("New ReminderConfig");
        return model.initializeReminderConfig();
    }
}).then(function(reminderConfig) {
    if (reminderConfig !== undefined) {
        console.log("Seeded reminder: " + reminderConfig.id);
    }
}, function(err) {
    console.log(err);
});
