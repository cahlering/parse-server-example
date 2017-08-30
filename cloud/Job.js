"use strict"

class Job {

    constructor(Parse){
        this.Parse = Parse;
        this.jobs = {};
    }

    put(name, req){
        var res = {
                success: (message) => {console.log(message)},
        error: (message) => {console.error(message)}
    }
        this.jobs[name] = (function () { this.Parse.Cloud.run(name, req, res); }).bind(this);
        return this;
    }

    get(name){
        return this.jobs[name];
    }

}

module.exports = Job;