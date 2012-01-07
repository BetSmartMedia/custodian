/**
 * Janitor
 *
 * Copyright (C) 2011 Bet Smart Media <http://www.betsmartmedia.com>
 *
 * It keeps the things running at the right intervals. But different than cron.
 *
 * With Janitor, you can schedule commands to run at specific intervals (eg,
 * every 30 seconds). You can also schedule commands to run after other
 * commands have completed.
 *
 * Janitor also provides basic watchdog functionality. If a process is not
 * running, it will be restarted.
 *
 * This code works on NodeJS 0.4.12.
 *
 * TODO: use nodules for hot-loading config?
 * TODO: use forever/daemon
 * TODO: move lib/* into proper npm dependencies
 * TODO: docs
 */

var sys     = require("sys");
var cproc   = require("child_process");
var fs      = require("fs");
var mailer  = require("./lib/node-mailer");
var ext     = require("./lib/node-ext");

var VERSION = '1.2.0';
var HOSTNAME = require('os').hostname();

// load config
if(process.argv.length < 3) {
	console.error("Usage: node janitor.js <config_file>");
	process.exit(1);
}
try {
	var c = fs.readFileSync(process.argv[2], "utf8");
	var CONFIG = JSON.parse(c);
} catch(e) {
	console.error("Error reading config:", e.message);
	process.exit(1);
}

// init state
STATE = {schedule:{}, watch:{}};
for(var x in CONFIG.schedule) STATE.schedule[x] = {running: false, last_run: new Date("1980/01/01 00:00:00")};
for(var x in CONFIG.watch)    STATE.watch[x]    = {pid: 0, last_restart: 0};

// open log
var log_fd = null;
if(CONFIG.log) {
	log_fd = fs.openSync(CONFIG.log, 'a', 0644);
}

function log(str) {
	var now = new Date().format("yyyy-mm-dd HH:MM:ss");
	var msg = "[" + now + "] " + str;
	console.log(str);
	// use sync for simplicity -- it's unsafe to have multiple write() calls
	// out to the same FD
	if(log_fd) fs.writeSync(log_fd, str + "\n");
}

/**
 * Watch any active jobs in STATE.watch.
 */
function watch_jobs() {
	var chkpid = function(p, cb) {
		if(p < 1) return cb(false);

		cproc.exec('ps -p '+p, function(err, stdout, stderr){
			if(err) return cb(false);
			cb(true);
		});
	};

	for(var x in STATE.watch) (function(x){
		chkpid(STATE.watch[x].pid, function(is_running){
			if(is_running) return;

			if(STATE.watch[x].output_fd) fs.closeSync(STATE.watch[x].output_fd);

			log(x+" is not running, restarting");
			var opts = {};
			if(CONFIG.watch[x].output) {
				// redirect stdout/stderr into the file specified
				// file will be opened in append mode
				var fd = fs.openSync(CONFIG.watch[x].output, 'a', 0644);
				if(fd < 1) {
					console.error("Error opening output file: " + CONFIG.watch[x].output);
				} else {
					opts.customFds = [-1, fd, fd];
					STATE.watch[x].output_fd = fd;
				}
			}
			var c = cproc.spawn(CONFIG.watch[x].cmd, [], opts);
			STATE.watch[x].pid = c.pid;
			log("   pid: "+c.pid);

			if(CONFIG.watch[x].notify) {
				new mailer.Mail({
					to:      CONFIG.email,
					from:    CONFIG.email,
					subject: 'Janitor | Process Restarted',
					body:    "Hostname: "+HOSTNAME+"\n\nProcess restarted: "+x+" (pid:"+c.pid+")\n"
				});
			}
		});
	})(x);
}

/**
 * Run a scheduled job.  When the job completes, look for other jobs ("sub-jobs")
 * that should run after this one, and execute them.
 *
 * If a sub-job is already running, then it is completely bypassed for this
 * dispatch cycle.
 */
function run_job(x) {
	var state = STATE.schedule[x],
	    cfg   = CONFIG.schedule[x];
	if(state.running) return console.log("... "+x+" is still running, skipping");

	var cmd = cfg.cmd;
	if(cfg.args) cfg.args.forEach(function(it){
		switch(it) {
			case 'last_run': cmd += ' "' + state.last_run.format("yyyy-mm-dd HH:MM:ss") + '"'; break;
			default:         console.log("Unrecognized dyn arg: "+it);
		}
	});
	STATE.schedule[x].running = true;
	STATE.schedule[x].last_run = new Date();

	log("exec " + x + ": " + cmd);
	var opts = {
		env:       { env: {IN_JANITOR: 1}},
		maxBuffer: 10*1024*1024 // 10MB
	};
	cproc.exec(cmd, opts, function(err, stdout, stderr){
		STATE.schedule[x].running = false;
		if(err) {
			new mailer.Mail({
				to:      CONFIG.admin_email,
				from:    CONFIG.admin_email,
				subject: 'Janitor | Command Error',
				body:    "Command returned an error.\n\nError: "+err+"\n\nHostname: "+HOSTNAME+"\nCommand: "+CONFIG.schedule[x].cmd+"\n\n"+sys.inspect(arguments)
			});
			console.log(x+": Gadzooks! Error!");
			console.dir(arguments);
		} else {
			log(x+": finished");
			if(stderr) {
				new mailer.Mail({
					to:      CONFIG.admin_email,
					from:    CONFIG.admin_email,
					subject: 'BSM | Command Error',
					body:    "Command returned some output on stderr.\n\nHostname: "+HOSTNAME+"\nCommand: "+CONFIG.schedule[x].cmd+"\n\n"+stderr
				});
			}
		}

		// find jobs that want to be run after this job, and execute them
		for(var y in CONFIG.schedule) (function(y){
			var m = /^after (.*)$/.exec(CONFIG.schedule[y].when);
			if(!m || m[1] != x) return;
			run_job(y);
		})(y);
	});
}

/**
 * Run jobs that should execute every X seconds
 */
function dispatch() {
	var now = new Date();

	// wrapping the guts of the loop in a function forces earlier
	// scope binding, which fixes the closures-in-loops gotcha.
	for(var x in CONFIG.schedule) (function(x){
		var m = /^every (.*)([smhd])$/.exec(CONFIG.schedule[x].when);
		if(!m) return;

		switch(m[2]) {
			case 's': var mult = 1;    break;
			case 'm': var mult = 60;   break;
			case 'h': var mult = 3600; break;
			case 'd': var mult = 86400;
		}

		if(STATE.schedule[x].last_run <= new Date(now - (m[1] * mult * 1000))) {
			run_job(x);
		}
	})(x);

	watch_jobs();
}

log("Janitor v"+VERSION+" starting...");
dispatch();
setInterval(dispatch, 5000);  // every 5 seconds
