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
var shellParse = require("shell-quote").parse;

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

	function reload (type, init) {
		var remove = {};
		for(var name in STATE[type]) remove[name] = true;
		for(var name in CONFIG[type]) {
			delete remove[name];
			var state = STATE[type][name] || clone(init)
			if (var cfg_env = CONFIG[type][name].env) {
				cfg_env.__proto__ = process.env;
			} else {
				cfg_env = process.env;
			}
			state.env = state.env || {};
			state.env.__proto__ = cfg_env;
		}
		for(var name in remove) delete STATE[type][name];
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

		for(var name in STATE.watch) (function(name){
			chkpid(STATE.watch[name].pid, function(is_running){
				var state = STATE.watch[name],
				    cfg   = CONFIG.watch[name];

				// if the config entry no longer exists, then it was probably removed
				// and we were SIGHUP'ed.
				if(cfg == undefined) return;

				if(is_running) return;

				// if `rate_limit` is set, don't restart the job more than once
				// every X seconds
				if(CONFIG.rate_limit) {
					var now = (new Date).getTime();
					if(now - state.last_restart < (CONFIG.rate_limit * 1000)) {
						log(name+" was started less than "+CONFIG.rate_limit+" seconds ago, deferring");
						return;
					}
				}

				log(name+" is not running, restarting");

				var c = spawn(name, cfg, state)
				if(cfg.notify) sendNotification("restarted", name, c.pid)
				state.last_restart = (new Date).getTime();
			});
		})(name);
	}

	/**
	 * Run a scheduled job.  When the job completes, look for other jobs ("sub-jobs")
	 * that should run after this one, and execute them.
	 *
	 * If a sub-job is already running, then it is completely bypassed for this
	 * dispatch cycle.
	 */
	function run_job(name) {
		var state = STATE.schedule[name],
				cfg   = CONFIG.schedule[name];
		if(state.running) return log("... "+name+" is still running, skipping");

		var cmd = cfg.cmd;
		if(cfg.args) cfg.args.forEach(function(it){
			switch(it) {
				case 'last_run': cmd += ' "' + dateFormat(state.last_run, "yyyy-mm-dd HH:MM:ss") + '"'; break;
				default:         console.log("Unrecognized dyn arg: "+it);
			}
		});
		state.running = true;

		var c = spawn(name, cfg, state);
		buffer_stderr(c);
		c.on('exit', function(code) {
			// TODO - should sub-jobs run after failure?
			// if (code) return

			// find jobs that want to be run after this job, and execute them
			Object.keys(CONFIG.schedule).forEach(function (next_job_name) {
				var next_job = CONFIG.schedule[next_job_name];
				var m = /^after (.*)$/.exec(next_job.when);
				if (!m || m[1] != name) return;
				run_job(next_job_name);
			})
		})
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

function sendNotification(kind, name, pid, body) {
	body || (body = "")
	new mailer.Mail({
		to:       CONFIG.notify_email || CONFIG.email,
		from:     CONFIG.from_email || CONFIG.email,
		subject:  'Custodian | Process ' + kind + '(' + name + ')',
		body:     "Hostname: " + HOSTNAME +
							"\nProcess: " + name +
							"\nPID: "+ pid +
							(body ? "\n\n" + body : ""),
		callback: function(err, data){}
	});
}

/**
 * Spawn a new process using the settings in `cfg` and return it.
 */
function spawn(name, cfg, state) {
	if (!(var cmd = cfg.cmd)) {
		console.error('No "cmd" in ' + name + ' cfg: ' + util.format(cfg));
		process.exit(2)
	}
	if (!(var args = cfg.args)) {
		args = shellParse(cmd);
		cmd = args.shift();
	}
	var cwd = cfg.cwd;

	args.map(function (it) {
		if (it[0] !== '$') return it
		return state.env[it.substring(1)] || ''
	});

	if((var output_file = cfg.output) && output_file !== state.output_file) {
		// redirect stdout/stderr into the file specified
		// file will be opened in append mode
		if (state.output) state.output.end()
		state.output = fs.createWriteStream(output_file, {flags: 'a', mode: 0644})
		state.output.on('error', function (err) {
			console.error("Error writing output file: " + output_file, err)
		}
		state.output_file = output_file;
		c.stdout.pipe(state.output)
		c.stderr.pipe(state.output)
	}

	var c = cproc.spawn(cmd, args, {env: state.env, cwd: cwd})
	state.pid = c.pid;
	state.last_run = (new Date()).getTime();
	log("Started " + name + "\n    pid: "+c.pid);
	c.on('error', sendNotification.bind(null, "error", name, c.pid))
	c.on('exit', function onExit (code) {
		if (!code) return // A-ok!
		sendNotification("error code " + code, name, c.pid)
		console.error(name+": Gadzooks! Error!");
	})
	return c;
}

function buffer_stderr(name, c, maxSize) {
	maxSize = maxSize || 10 * 1024 * 1024;  // 10MB
	var buffer = new Buffer(maxSize);
		, position = 0;
	c.stderr.on('data', function write (data) {
		if (data.length + position < buffer.length) {
			data.copy(buffer, position)
			position += data.length
			return
		} 
		var msg = "STDERR > 10MB:\n... " + buffer.slice(position - 1024, position) + data;
		c.emit('error', msg);
		buffer = new Buffer(maxSize);
		position = 0;
	})
	c.on('exit', function(code) {
		if (position > 0) {
			sendNotification('returned output on stderr', name, c.pid, buffer.slice(0, position))
		}
	})
}
