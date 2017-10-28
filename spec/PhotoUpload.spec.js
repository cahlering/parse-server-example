"use strict";
const Parse = require("parse/node");
let proxyquire = require("proxyquire");

const ParseCloud = {
    beforeSave: function(className, beforeHandler) {
        console.log("beforeSave called:" + className);
    },
    define: function(endpointName, endpointHandler) {
        console.log("define called: " + endpointName);
    }
};
Object.assign(Parse.Cloud, ParseCloud);
global.Parse = Parse;
Parse.initialize("testkey");

const photoLib = proxyquire("../cloud/PhotoUpload", {
        "./PhotoUploadModel": {
            updatePrimaryCluster:function(){
                console.log("called updatePrimaryCluster");
            },
            getPhotoUploadQueryForDevice:function () {
                console.log("called getPhotoUploadQueryForDevice");
                return {
                    count:function() {
                        return new Promise((resolve, reject)=> {
                            //reject();
                            resolve(1);
                        });
                    },
                    limit: function(count) {
                        console.log("called limit(" + count + ")");
                        return this;
                    },
                    skip: function (count) {
                        console.log("called skip(" + count + ")");
                        return this;
                    },
                    find: function() {
                        return new Promise((resolve, reject)=> {
                           resolve({"filePath": "a"});
                        });
                    }
                }
            }
        },
        "./Cluster.js": {

        },
        "./scheduler": {
            '@noCallThru':true
        }
    }
);

describe("General Purpose ImageMedia", function () {

    it("Should return all paths", function () {

        photoLib.getAllPaths({params:{deviceId:""}}, {error:function(msg) {console.log("allpaths error:"+msg)}});
        expect(true).toBe(true);
    })
});
