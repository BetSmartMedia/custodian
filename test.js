child_process = require('child_process')
mailer        = require("nodemailer");

mocks         = require('./test/mocks')
FakeProcess   = mocks.FakeProcess
FakeTransport = mocks.FakeTransport

// install mocks
mailer.createTransport = function () { return new FakeTransport };

child_process.spawn = function mockSpawn (cmd, args, opts) { return new FakeProcess(cmd, args, opts) };

run = require('./custodian').run;

var tests = [
	scheduledJob,
	watchedJobsAreRestarted,
	argumentsAreParsed,
	argumentsFromEnvironment,
	scheduledJobsRunRepeatedly,
	watchedJobRateLimiting
]


;(function runTests (tests) {
	var i = 0
		, CONFIG
		, STATE;

	function done (message) {
		clearInterval(STATE.interval);
		FakeProcess.finished(message)
		nextTest()
	}

	function nextTest (message) {
		var test = tests[i++];
		if (!test) return;
		console.log('\n## Start test ' + test.name)
		CONFIG = {schedule:{}, watch:{}, check_interval: 1};
		STATE  = {schedule:{}, watch:{}};
		FakeProcess.pid = 1000;
		test(CONFIG, STATE, done)
	}

	nextTest()
})(tests);

//=== Tests ===//

function scheduledJob (CONFIG, STATE, done) {
	CONFIG.schedule.schedule_test = {
		cmd: 'do_something',
		when: "every 1d"
	}

	FakeProcess.expect(['do_something', [], {
		env: process.env,
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}])

	run(CONFIG, STATE);

	process.nextTick(function () {
		done('scheduled job runs immediately')
	})
}


function watchedJobsAreRestarted (CONFIG, STATE, done) {

	CONFIG.watch.watch_me = { cmd: 'watch_me' };

	var expectation = ['watch_me', [], {
		env: process.env,
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}];

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

function argumentsAreParsed (CONFIG, STATE, done) {
	CONFIG.schedule.schedule_test = {
		cmd: 'do_something --with-option two',
		when: "every 1d"
	}

	FakeProcess.expect(['do_something', ['--with-option', 'two'], {
		env: process.env,
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}])

	run(CONFIG, STATE);

	process.nextTick(function () {
		done('args are parsed')
	})
}


function argumentsFromEnvironment (CONFIG, STATE, done) {
	CONFIG.schedule.schedule_test = {
		cmd: 'do_something --with-option $two',
		when: "every 1d",
		env: {two: 'two from environment'}
	}

	FakeProcess.expect(['do_something', ['--with-option', 'two from environment'], {
		env: {two: 'two from environment'},
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}])

	run(CONFIG, STATE);

	process.nextTick(function () {
		done('args can access env variables')
	})
}


function scheduledJobsRunRepeatedly (CONFIG, STATE, done) {
	CONFIG.schedule.do_something = {
		cmd: 'do_something',
		when: "every 0.01s",
	}

	var expectation = ['do_something', [], {
		env: process.env,
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}]

	FakeProcess.expect(expectation);
	FakeProcess.expect(expectation);
	FakeProcess.expect(expectation);

	// Exit the current process so the next one will start
	exitInterval = setInterval(function () {
		STATE.schedule.do_something.process.exit(0)
	}, 10)

	run(CONFIG, STATE);

	setTimeout(function ()  {
		clearInterval(exitInterval);
		done('scheduled jobs get run repeatedly')
	}, 25)
}

function watchedJobRateLimiting (CONFIG, STATE, done) {
	CONFIG.rate_limit = 0.01;
	CONFIG.watch.only_twice = {
		cmd: 'rate_limit',
	}

	var expectation = ['rate_limit', [], {
		env: process.env,
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}]

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
		clearTimeout(STATE.watch.only_twice.timeout)
		clearInterval(exitInterval)
		done("Restarts of watched jobs are rate-limited")
	}, 12)
}
