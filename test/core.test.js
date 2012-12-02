var assert        = require('assert')
var mocks         = require('./mocks')
var FakeProcess   = mocks.FakeProcess
var FakeTransport = mocks.FakeTransport
var spawnOpts     = mocks.spawnOpts


/**
 * Load the function we're testing
 */
var run;

/* Global setup and teardown - mock out spawning of processes and sending email */
exports.before = mocks.install
exports.after = mocks.uninstall

/* Per-test setup and teardown */
exports.beforeEach = function (args) {
	args.push(mocks.blankConfig());
	args.push(mocks.blankState())
	run = require('../custodian').run;
}

exports.afterEach = function (message, args) {
	clearInterval(args[1].interval); // STATE.interval
	FakeProcess.finished(message)
}

/* TESTS */

exports.scheduledJob = function (CONFIG, STATE, done) {
	CONFIG.schedule.schedule_test = {
		cmd: 'do_something',
		when: "every 1d"
	}

	FakeProcess.expect(['do_something', [], spawnOpts()])

	run(CONFIG, STATE);

	nextTick(function () {
		done('scheduled job runs immediately')
	})
}


exports.watchedJobsAreRestarted = function (CONFIG, STATE, done) {

	CONFIG.watch.watch_me = { cmd: 'watch_me' };

	var expectation = ['watch_me', [], spawnOpts()];

	FakeProcess.expect(expectation)
	// expect process to be restarted
	FakeProcess.expect(expectation);

	run(CONFIG, STATE);

	setTimeout(function () {
		STATE.watch.watch_me.process.exit(0);
	}, 10)

	setTimeout(function () {
		done("watched jobs are restarted")
	}, 20)
}


exports.argumentsAreParsed = function (CONFIG, STATE, done) {
	CONFIG.schedule.schedule_test = {
		cmd: 'do_something --with-option two',
		when: "every 1d"
	}

	FakeProcess.expect(['do_something', ['--with-option', 'two'], spawnOpts()])

	run(CONFIG, STATE);

	nextTick(function () {
		done('args are parsed')
	})
}


exports.argumentsFromEnvironment = function (CONFIG, STATE, done) {
	CONFIG.env.one = "one"
	CONFIG.schedule.env_vars_test = {
		cmd: 'do_something --with-option $two $one',
		when: "every 1d",
		env: {two: 'two from environment'}
	}

	FakeProcess.expect(['do_something', ['--with-option', 'two from environment', 'one'], spawnOpts({'env': {'two': 'two from environment'}})]);

	run(CONFIG, STATE);

	nextTick(function () {
		done('args can access env variables')
	})
}


exports.scheduledJobsRunRepeatedly = function (CONFIG, STATE, done) {
	CONFIG.schedule.do_something = {
		cmd: 'do_something',
		when: "every 0.01s",
	}

	var expectation = ['do_something', [], spawnOpts()]

	FakeProcess.expect(expectation);
	FakeProcess.expect(expectation);
	FakeProcess.expect(expectation);

	// Exit the current process so the scheduler will run it
	exitInterval = setInterval(function () {
		STATE.schedule.do_something.process.exit(0)
	}, 10)

	run(CONFIG, STATE);

	setTimeout(function ()  {
		clearInterval(exitInterval);
		done('scheduled jobs get run repeatedly')
	}, 25)
}


exports.waitsForScheduledJobsToExit = function (CONFIG, STATE, done) {
	CONFIG.schedule.slow_job = {
		cmd: 'slow_job',
		when: 'every 0.01s'
	}

	FakeProcess.expect(['slow_job', [], spawnOpts()]);

	run(CONFIG, STATE)

	setTimeout(function () {
		done("scheduled jobs don't run if they're already running")
	}, 50)
}


exports.watchedJobRateLimiting = function (CONFIG, STATE, done) {
	CONFIG.rate_limit = 0.01;
	CONFIG.watch.only_twice = {
		cmd: 'rate_limit',
	}

	var expectation = ['rate_limit', [], spawnOpts()]

	// Should run two times
	FakeProcess.expect(expectation)
	FakeProcess.expect(expectation)

	run(CONFIG, STATE)

	// Exit the process if it's running every 5ms
	exitInterval = setInterval(function () {
		if (STATE.watch.only_twice.process) STATE.watch.only_twice.process.exit(0)
	}, 5)

	// After 15ms the job should have started twice
	setTimeout(function () {
		clearInterval(exitInterval)
		clearTimeout(STATE.watch.only_twice.timeout)
		done("Restarts of watched jobs are rate-limited")
	}, 12)
}


exports.nonZeroExitIsReported = function (CONFIG, STATE, done) {
	CONFIG.schedule.error_code_test = {
		cmd: 'do_something',
		when: "every 1d"
	}

	FakeProcess.expect(['do_something', [], spawnOpts()])

	new FakeTransport().expect({
		to:      CONFIG.email,
	  from:    CONFIG.email,
	  subject: 'Custodian | Process returned code 12 (error_code_test)',
	  text:    "Hostname: " + require('os').hostname() +
		         "\nProcess: error_code_test" +
		         "\nPID: 1000" + "",
	})

	run(CONFIG, STATE);

	nextTick(function () {
		STATE.schedule.error_code_test.process.exit(12)
		nextTick(function () {
			done('Non-Zero exit sends email')
		})
	})
}



exports.maxtimeKill = function (CONFIG, STATE, done) {
	CONFIG.schedule.schedule_test = {
		cmd: 'do_something',
		when: "every 1d",
		maxtime: '0.01s'
	}

	var kill = process.kill
	process.kill = function (pid) {
		process.kill = kill
		assert.equal(pid, FakeProcess.pid)
		done('Process is killed when maxtime is reached')
	}

	FakeProcess.expect(['do_something', [], spawnOpts()])

	run(CONFIG, STATE);
}
/* Helpers */
var nextTick = process.nextTick;
