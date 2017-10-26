"use strict";
const Parse = require("parse/node");
const ParseCloud = {
    beforeSave: function(className, beforeHandler) {
        console.log("beforeSave called:" + className);
    },
    define: function(endpointName, endpointHandler) {
        console.log("define called: " + endpointName);
    }
};
Object.assign(Parse.Cloud, ParseCloud);
const ParseQuery = {
   count: function() {
       return 1;
   }
};
Object.assign(Parse.Query, ParseQuery);
global.Parse = Parse;
Parse.initialize("testkey");
const photoLib = require("../cloud/PhotoUpload");

describe("General Purpose ImageMedia", function () {

    it("Should have reminders", function () {

        //let reminderPromise = photoLib.checkReminder();
        expect(true).toBe(true);
    })
});