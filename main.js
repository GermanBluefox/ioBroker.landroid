/**
 *
 *      ioBroker Worx Landroid Adapter
 *
 *      (c) 2017 ldittmar <iobroker@lmdsoft.de>
 *
 *      MIT License
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils = require(__dirname + "/lib/utils"); // Get common adapter utils
var http = require("http");
var ping = require("ping");

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = utils.adapter("landroid");

var ip = "";
var options = {};
var postOptions = {};

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on("unload", function (callback) {
    try {
        adapter.log.info("cleaned everything up...");
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on("objectChange", function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info("objectChange " + id + " " + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on("stateChange", function (id, state) {

    if (!state) {
        return;
    }

    if (id === adapter.namespace + ".mower.start") {
        startMower();
    }
    else if (id === adapter.namespace + ".mower.stop") {
        stopMower();
    }

});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on("message", function (obj) {
    if (typeof obj == "object" && obj.message) {
        if (obj.command == "send") {
            // e.g. send email or pushover or whatever
            console.log("send command");

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, "Message received", obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on("ready", function () {
    main();
});

function startMower() {
    adapter.setState("mower.start", {val: false, ack: true});
}

function stopMower() {
    adapter.setState("mower.stop", {val: false, ack: true});
}

function evaluateCalendar(arrHour, arrMin, arrTime) {
    var weekday = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (var i = 0; i < weekday.length; i++) {
        var starttime = (arrHour[i] < 10) ? "0" + arrHour[i] : arrHour[i];
        starttime += ":";
        starttime += (arrMin[i] < 10) ? "0" + arrMin[i] : arrMin[i];
        adapter.setState("calendar." + weekday[i] + ".startTime", {val: starttime, ack: true});
        adapter.setState("calendar." + weekday[i] + ".workTime", {val: arrTime[i] * 0.1, ack: true});
    }
}

function getStatus(statusArr, alarmArr) {

    var alarm = false;
    for (var i = 0; i < alarmArr.length; i++) {
        if (alarmArr[i] === 1) {
            alarm = true;
            break;
        }
    }

    if (statusArr[14] === 1 && !alarm) {
        return 'manual_stop';
    }
    else if (statusArr[5] === 1 && statusArr[13] === 0 && !alarm) {
        return 'charging';
    }
    else if (statusArr[5] === 1 && statusArr[13] === 1 && !alarm) {
        return 'charge_completed';
    }
    else if (statusArr[15] === 1 && !alarm) {
        return 'going_home';
    }
    else if (alarmArr[0] === 1) {
        return 'blade_blocked';
    }
    else if (alarmArr[1] === 1) {
        return 'repositioning_error';
    }
    else if (alarmArr[2] === 1) {
        return 'outside_wire';
    }
    else if (alarmArr[3] === 1) {
        return 'blade_blocked';
    }
    else if (alarmArr[4] === 1) {
        return 'outside_wire';
    }
    else if (alarmArr[10] === 1) {
        return 'mower_tilted';
    }
    else if (alarmArr[5] === 1) {
        return 'mower_lifted';
    }
    else if (alarmArr[6] === 1 || alarmArr[7] === 1 || alarmArr[8] === 1) {
        return 'error';
    }
    else if (alarmArr[9] === 1) {
        return 'collision_sensor_blocked';
    }
    else if (alarmArr[11] === 1) {
        return 'charge_error';
    }
    else if (alarmArr[12] === 1) {
        return 'battery_error';
    }
    else {
        return 'mowing';
    }
}

function checkFirmware(data) {
    if (data.CntProg) {
        return "0." + data.CntProg;
    }
    return data.versione_fw;
}

function evaluateResponse(data) {
    adapter.setState("lastsync", {val: new Date().toISOString(), ack: true});
    adapter.setState("firmware", {val: checkFirmware(data), ack: true});

    evaluateCalendar(data.ora_on, data.min_on, data.ore_funz);

    adapter.setState("mower.waitRain", {val: data.rit_pioggia, ack: true});
    adapter.setState("mower.batteryState", {val: data.perc_batt, ack: true});
    adapter.setState("mower.areasUse", {val: data.num_aree_lavoro, ack: true});
    adapter.setState("mower.totalTime", {val: data.ore_movimento * 0.1, ack: true});
    adapter.setState("mower.borderCut", {val: data.enab_bordo === 1, ack: true});
    adapter.setState("mower.status", {val: getStatus(data.settaggi, data.allarmi), ack: true});
}

function checkStatus() {
    ping.sys.probe(ip, function (isAlive) {
        adapter.setState("mower.connected", {val: isAlive, ack: true});
        if (isAlive) {
            var req = http.get(options, function (res) {
                res.setEncoding("utf8");
                var body = '';
                res.on("data", function (data) {
                    body += data;
                });
                res.on("end", function () {
                    var parsed = JSON.parse(body);
                    evaluateResponse(parsed);
                });
            });
        }
    });
}

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    var pin = adapter.config.pin;
    ip = adapter.config.ip;

    if (ip && pin && pin.match(/^\d{4}$/)) {

        options = {
            host: ip,
            port: "80",
            path: "/jsondata.cgi",
            method: "GET",
            headers: {"Authorization": 'Basic ' + new Buffer('admin:' + adapter.config.pin).toString('base64')}
        };

        adapter.subscribeStates("mower.start");
        adapter.subscribeStates("mower.stop");

        var secs = adapter.config.poll;
        if (isNaN(secs) || secs < 1) {
            secs = 10;
        }

        setInterval(checkStatus, secs * 1000);

    } else {
        adapter.log.error("Please configure the Landroid Adapter and restart it");
    }

}
