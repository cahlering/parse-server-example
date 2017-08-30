"use strict"
var Cron = require('./Cron');
var Job = require('./Job');

class CloudCode {

    constructor(Parse, timezone){
        this.Parse = Parse;
        this.cron = new Cron(timezone);
        this.job = new Job(this.Parse);
    }

    putJob(name, req){
        this.job.put(name, req);
        return this;
    }

    addCron(name, timeFormat){
        this.cron.addJob(timeFormat, this.job.get(name));
        return this;
    }

    start(){
        this.cron.on();
    }

    stop(){
        this.cron.off();
    }

}

module.exports = CloudCode;