#!/usr/bin/env node
/**
 * Custodian
 *
 * Copyright (C) 2011 Bet Smart Media <http://www.betsmartmedia.com>
 *
 * It keeps the things running at the right intervals. But different than cron.
 *
 * With Custodian, you can schedule commands to run at specific intervals (eg,
 * every 30 seconds). You can also schedule commands to run after other
 * commands have completed.
 *
 * Custodian also provides basic watchdog functionality. If a process is not
 * running, it will be restarted.
 *
 * This code works on NodeJS 0.6.10.
 */

var util       = require("util");
var cproc      = require("child_process");
var fs         = require("fs");
var mailer     = require("./lib/node-mailer");
var daemon     = require("daemon");
var dateFormat = require("dateformat");

var VERSION  = require('./package.json').version;
var HOSTNAME = require('os').hostname();
var CFG_FILE = null;

var CONFIG = {};
var STATE  = {schedule:{}, watch:{}};

process.env.IN_CUSTODIAN = 1

/**
 * Read and parse config
 */
if(process.argv.length < 3) {
	console.error("Usage: node custodian.js <config_file>");
	process.exit(1);
}

CFG_FILE = process.argv[2];
load_config();

/**
 * Run as a daemon or as a regular process
 */
if (CONFIG.daemon) {
	// become a daemon
	['log','pid'].map(function(d) {
		if(!CONFIG[d]) {
			console.error("Error: '"+d+"' directive must be specified when run as a daemon.");
			process.exit(1);
		}
	});
	daemon.daemonize(CONFIG.log, CONFIG.pid, function(err, pid) {
		if(err) {
			console.log("Error starting daemon: " + err);
			process.exit(1);
		}

		// catch SIGTERM and remove PID file
		process.on('SIGTERM', function() {
			console.log("Caught SIGTERM - shutting down");
			fs.unlinkSync(CONFIG.pid);
			process.exit(0);
		});

		run();
	});
} else {
	// ... or run as a regular process
	run();
}

// catch SIGHUP and reload config
process.on('SIGHUP', function() {
	console.log("Caught SIGHUP - reloading configuration");
	load_config();
	init_state();
});


/**
 * Load configuration
 */
function load_config() {
	try {
		var c = fs.readFileSync(CFG_FILE, "utf8");
		CONFIG = JSON.parse(c);
	} catch(e) {
		console.error("Error reading config:", e.message);
		process.exit(1);
	}
}

/**
 * Initialize (or re-initialize) state
 */
function init_state() {
	function clone (o) {
		var c = {};
		for(var x in o) c[x] = o[x];
		return c;
	}

	function reload (key, init) {
		var remove = {};
		for(var x in STATE[key]) remove[x] = true;
		for(var x in CONFIG[key]) {
			delete remove[x];
			if(STATE[key][x] == undefined) {
				STATE[key][x] = clone(init);
			}
		}
		for(var x in remove) delete STATE[key][x];
	}

	reload('schedule', {running: false, last_run: new Date("1980/01/01 00:00:00")});
	reload('watch',    {pid: 0, last_restart: 0});
}

function log(str) {
	var now = dateFormat(new Date, "yyyy-mm-dd HH:MM:ss");
	var msg = "[" + now + "] " + str;
	console.log(msg);
}

/**
 * Main mojo
 */
function run() {
	// init state
	init_state();

	/**
	 * Watch any active jobs in STATE.watch.
	 */
	function watch_jobs() {
		function chkpid (p, cb) {
			if(p < 1) return cb(false);

			cproc.exec('ps -p '+p, function(err, stdout, stderr){
				cb(err ? false : true);
			});
		};

		for(var x in STATE.watch) (function(x){
			chkpid(STATE.watch[x].pid, function(is_running){
				var state = STATE.watch[x],
				    cfg   = CONFIG.watch[x];

				// if the config entry no longer exists, then it was probably removed
				// and we were SIGHUP'ed.
				if(cfg == undefined) return;

				if(is_running) return;

				if(state.output_fd) {
					fs.closeSync(state.output_fd);
					delete state.output_fd;
				}

				// if `rate_limit` is set, don't restart the job more than once
				// every X seconds
				if(CONFIG.rate_limit) {
					var now = (new Date).getTime();
					if(now - state.last_restart < (CONFIG.rate_limit * 1000)) {
						log(x+" was started less than "+CONFIG.rate_limit+" seconds ago, deferring");
						return;
					}
				}

				log(x+" is not running, restarting");
				if(cfg.output) {
					// redirect stdout/stderr into the file specified
					// file will be opened in append mode
					var fd = fs.openSync(cfg.output, 'a', 0644);
					if(fd < 1) {
						console.error("Error opening output file: " + cfg.output);
					} else {
						state.output_fd = fd;
					}
				}

				var args = [];
				var cmd  = cfg.cmd;
				var opts = {};
				if(Array.isArray(cfg.cmd)) {
					cmd  = cfg.cmd[0];
					args = cfg.cmd.slice(1);
				}
				if(cfg.cwd) {
					opts.cwd = cfg.cwd;
				}
				var c = cproc.spawn(cmd, args, opts);
				state.pid = c.pid;
				state.last_restart = (new Date()).getTime();
				log("   pid: "+c.pid);

				if(state.output_fd) {
					(function(cfg, state){
						var recv = function(data) {
							// use sync for writes, as it can be dangerous to have multiple async
							// writes in progress at the same time
							try {
								var b = fs.writeSync(state.output_fd, data.toString('utf8'));
							} catch(e) {
								console.error("Error writing to output file:", cfg.output);
								console.error("  FD:", state.output_fd);
								console.error("  Error:", e.message);
							}
						};
						c.stdout.on('data', recv);
						c.stderr.on('data', recv);
					})(cfg, state);
				}

				if(cfg.notify) {
					new mailer.Mail({
						to:       CONFIG.notify_email || CONFIG.email,
						from:     CONFIG.from_email || CONFIG.email,
						subject:  'Custodian | Process Restarted',
						body:     "Hostname: "+HOSTNAME+"\n\nProcess restarted: "+x+" (pid:"+c.pid+")\n",
						callback: function(err, data){}
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
		if(state.running) return log("... "+x+" is still running, skipping");

		var cmd = cfg.cmd;
		if(cfg.args) cfg.args.forEach(function(it){
			switch(it) {
				case 'last_run': cmd += ' "' + dateFormat(state.last_run, "yyyy-mm-dd HH:MM:ss") + '"'; break;
				default:         console.log("Unrecognized dyn arg: "+it);
			}
		});
		state.running = true;
		state.last_run = new Date();

		log("exec " + x + ": " + cmd);
		var opts = {
			maxBuffer: 10*1024*1024, // 10MB
			cwd:       cfg.cwd || null
		};

		cproc.exec(cmd, opts, function(err, stdout, stderr){
			state.running = false;
			if(err) {
				new mailer.Mail({
					to:       CONFIG.notify_email || CONFIG.email,
					from:     CONFIG.from_email || CONFIG.email,
					subject:  'Custodian | Command Error',
					body:     "Command returned an error.\n\nError: "+err+"\n\nHostname: "+HOSTNAME+"\nCommand: "+cfg.cmd+"\n\n"+util.inspect(arguments),
					callback: function(err, data){}
				});
				console.log(x+": Gadzooks! Error!");
				console.dir(arguments);
			} else {
				log(x+": finished");
				if(stderr) {
					new mailer.Mail({
						to:       CONFIG.notify_email || CONFIG.email,
						from:     CONFIG.from_email || CONFIG.email,
						subject:  'Custodian | Command Error',
						body:     "Command returned some output on stderr.\n\nHostname: "+HOSTNAME+"\nCommand: "+cfg.cmd+"\n\n"+stderr,
						callback: function(err, data){}
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

	log("Custodian v"+VERSION+" starting...");
	dispatch();
	setInterval(dispatch, 5000);  // every 5 seconds
}
