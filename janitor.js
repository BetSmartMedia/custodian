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
 * This code works on NodeJS 0.4.18.
 *
 * TODO: use nodules for hot-loading config?
 * TODO: use forever/daemon
 */

var sys     = require("sys");
var cproc   = require("child_process");
var mailer  = require("./lib/node-mailer");
var ext     = require("./lib/node-ext");

var VERSION = '1.1.4';

var hostname = '';
cproc.exec('hostname -f', function(err, stdout, stderr){
	hostname = stdout;
});

// load config
var C;
var name = process.argv[2] ? process.argv[2] : './config';
var C = require(name);
var CONFIG      = C.config
var ADMIN_EMAIL = C.admin_email;

// init state
STATE = {schedule:{}, watch:{}};
for(var x in CONFIG.schedule) STATE.schedule[x] = {running: false, last_run: new Date("1980/01/01 00:00:00")};
for(var x in CONFIG.watch)    STATE.watch[x]    = {pid: 0, last_restart: 0};

function log(str) {
	var now = new Date().format("yyyy-mm-dd HH:MM:ss");
	sys.puts("[" + now + "] " + str);
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

			sys.puts(x+" is not running, restarting");
			var c = cproc.spawn(CONFIG.watch[x].cmd);
			STATE.watch[x].pid = c.pid;
			sys.puts("   pid: "+c.pid);

			if(CONFIG.watch[x].notify) {
				mailer.send({
					to:      ADMIN_EMAIL,
					from:    ADMIN_EMAIL,
					subject: 'BSM | Janitor',
					body:    "Hostname: "+hostname+"\n\nProcess restarted: "+x+" (pid:"+c.pid+")\n"
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
	if(state.running) return sys.puts("... "+x+" is still running, skipping");

	var cmd = cfg.cmd;
	if(cfg.args) cfg.args.forEach(function(it){
		switch(it) {
			case 'last_run': cmd += ' "' + state.last_run.format("yyyy-mm-dd HH:MM:ss") + '"'; break;
			default:         sys.puts("Unrecognized dyn arg: "+it);
		}
	});
	STATE.schedule[x].running = true;
	STATE.schedule[x].last_run = new Date();
	log("exec " + x + ": " + cmd);
	cproc.exec(cmd, {env: {IN_JANITOR:1}}, function(err, stdout, stderr){
		STATE.schedule[x].running = false;
		if(err) {
			mailer.send({
				to:      ADMIN_EMAIL,
				from:    ADMIN_EMAIL,
				subject: 'BSM | Janitor',
				body:    "Command returned an error.\n\nError: "+err+"\n\nHostname: "+hostname+"\nCommand: "+CONFIG.schedule[x].cmd+"\n\n"+sys.inspect(arguments)
			});
			sys.puts(x+": Gadzooks! Error!");
			sys.puts(sys.inspect(arguments));
		} else {
			log(x+": finished");
			//process.stdio.write(stdout);
			if(stderr) {
				mailer.send({
					to:      ADMIN_EMAIL,
					from:    ADMIN_EMAIL,
					subject: 'BSM | Janitor',
					body:    "Command returned some output on stderr.\n\nHostname: "+hostname+"\nCommand: "+CONFIG.schedule[x].cmd+"\n\n"+stderr
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

sys.puts("Janitor v"+VERSION+" starting...");
dispatch();
setInterval(dispatch, 5000);  // every 5 seconds
