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
var daemon     = require("daemon");
var dateFormat = require("dateformat");

var shellParse = require("shell-quote").parse;
var temp       = require("temp");

var VERSION  = require('./package.json').version;
var mailer     = require("./lib/node-mailer");
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
load_config(true);

/**
 * Run as a daemon or as a regular process
 */
if (CONFIG.daemon) {
	// become a daemon
	['log','pid'].forEach(function(d) {
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
function load_config(exitOnFailure) {
	try {
		var c = fs.readFileSync(CFG_FILE, "utf8");
		CONFIG = JSON.parse(c);
	} catch(e) {
		console.error("Error reading config:", e.message);
		if (exitOnFailure) process.exit(1);
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
			var state = STATE[type][name] = STATE[type][name] || clone(init);
			var cfg_env;
			if (cfg_env = CONFIG[type][name].env) {
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
	 * Run jobs that should execute every X seconds
	 */
	function dispatch () {
		var now = new Date();

		// wrapping the guts of the loop in a function forces earlier
		// scope binding, which fixes the closures-in-loops gotcha.
		Object.keys(CONFIG.schedule).forEach(function (x) {
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
		})
		check_watched_jobs();
	}

	log("Custodian v"+VERSION+" starting...");
	dispatch();
	setInterval(dispatch, 5000);  // every 5 seconds

	/**
	 * Check on the jobs in CONFIG.watch, restarting those that aren't running, and
	 * killing those that are no longer in the config.
	 */
	function check_watched_jobs () {

		var config_jobs = Object.keys(CONFIG.watch)
			, is_stale = function (name) { return config_jobs.indexOf(name) === -1 }
			, removed_jobs  = Object.keys(STATE.watch).filter(is_stale)

		config_jobs.forEach(function (name) {
			var cfg   = CONFIG.watch[name]
				, state = STATE.watch[name]
				
			var state = STATE.watch[name],
					cfg   = CONFIG.watch[name];

			if (state.pid) return;

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

			var c = spawn(name, cfg, state).on('exit', function () { delete state.pid });

			if (cfg.notify) sendNotification("restarted", name, c.pid);
			state.last_restart = (new Date).getTime();
		});

		// Kill any jobs that are no longer in the config but still running.
		removed_jobs.forEach(function (name) {
			if (STATE.watch[name] && STATE.watch[name].pid) process.kill(STATE.watch[name].pid)
		});
	}

	/**
	 * Run a scheduled job.  When the job completes, look for other jobs ("sub-jobs")
	 * that should run after this one, and execute them.
	 *
	 * If a sub-job is already running, then it is completely bypassed for this
	 * dispatch cycle.
	 */
	function run_job (name) {
		var state = STATE.schedule[name],
				cfg   = CONFIG.schedule[name];
		if(state.running) return log("... "+name+" is still running, skipping");

		if(cfg.args) cfg.args.forEach(function(it){
			switch(it) {
				case 'last_run': cfg.cmd += ' "' + dateFormat(state.last_run, "yyyy-mm-dd HH:MM:ss") + '"'; break;
				default:         console.log("Unrecognized dyn arg: "+it);
			}
		});
		state.running = true;

		var c = spawn(name, cfg, state);
		c.on('exit', function runAfter (code) {
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

}

function sendNotification(kind, name, pid, body) {
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
	var cmd
		, args;
	if (!(cmd = cfg.cmd)) {
		console.error('No "cmd" in ' + name + ' cfg: ' + util.format(cfg));
		process.exit(2)
	}
	args = shellParse(cmd);
	cmd = args.shift();
	var cwd = cfg.cwd;

	args.map(function (it) {
		if (it[0] !== '$') return it
		return state.env[it.substring(1)] || ''
	});

	var stdio = ['ignore']; // No stdin
	if(cfg.output && cfg.output !== state.output) {
		// redirect stdout/stderr into the file specified
		// file will be opened in append mode
		if (state.output_fd) fs.closeSync(state.output_fd)
		state.output = cfg.output;
		state.output_fd = fs.openSync(cfg.output, 'a')
		stdio[1] = stdio[2] = state.output_fd;
	} else if (!cfg.output) {
		// open a temp file for stdout/stderr
		var tmp_info = temp.openSync({prefix: name, suffix: '.log'});
		state.output_fd = stdio[1] = stdio[2] = tmp_info.fd;
		state.output = tmp_info.path;
	}

	var c = cproc.spawn(cmd, args, {env: state.env, cwd: cwd, stdio: stdio})

	state.pid = c.pid;
	state.last_run = (new Date()).getTime();
	c.on('error', sendNotification.bind(null, "error", name, c.pid))
	c.on('exit', function onExit (code) {
		if (!code) return fs.closeSync(state.output_fd)
		sendNotification("returned code " + code, name, c.pid, "Output is readable in " + state.ouput);
		console.error("Gadzooks! Error! " + name);
	})
	return c;
}
