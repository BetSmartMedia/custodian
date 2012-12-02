/**
 * Specialized mocks for:
 *   - child processes
 *   - sending email
 *
 * TODO - fork https://github.com/vojtajina/node-mocks and integrate these to
 * make mocking filesystem operations possible.
 */
var util          = require('util')
var assert        = require('assert')
var child_process = require('child_process')
var mailer        = require("nodemailer");
var EventEmitter  = require('events').EventEmitter
var Stream        = require('stream').Stream
var shellQuote    = require('shell-quote').quote

exports.FakeProcess   = FakeProcess
exports.FakeTransport = FakeTransport

exports.blankConfig = function () {
	return {
		email: 'test@example.com',
		check_interval: 1,
		schedule:{},
		watch:{},
	}
}

exports.blankState = function () { return { schedule:{}, watch:{} } }

exports.spawnOpts = function (opts) {
	var ret = {
		env: {},
		cwd: process.cwd(),
		stdio: ['ignore', 'ignore', 'ignore']
	}
	if (opts) for (var k in opts) ret[k] = opts[k];
	ret.env.__proto__ = process.env;
	return ret;
}

var realCreateTransport = mailer.createTransport;
var realSpawn = child_process.spawn;
var installed = false;

exports.install = function () {
	if (installed) throw new Error("Mocks already installed, maybe you need to uninstall them after the previous test suite?")
	mailer.createTransport = function () { return new FakeTransport };
	child_process.spawn = function mockSpawn (cmd, args, opts) { return new FakeProcess(cmd, args, opts) };

	// Clear custodian from require cache to ensure it loads mocked deps
	delete require.cache[require.resolve('../custodian')]

	installed = true
}

exports.uninstall = function () {
	mailer.createTransport = realCreateTransport;
	child_process.spawn = realSpawn;
	installed = false;
}

function FakeProcess (cmd, args, opts) {

	// check that the spawn call was valid
	var expect = FakeProcess.expected.shift()
	if (!expect) throw new Error("Unexpected call to spawn: " + [cmd, args, opts, (new Date - FakeProcess.started)].toString());

	// Run callback if expectation has one
	if (typeof expect[expect.length - 1] === 'function') expect.pop()(cmd, args, opts)
	assert.deepEqual([cmd, args, opts], expect)

	EventEmitter.call(this)

	this.cmd    = cmd;
	this.args   = args;
	this.opts   = opts;
	this.stdout = new Stream;
	this.stderr = new Stream;
	this.pid    = ++FakeProcess.pid;

	var self = this;
	this.exit = function (code) {
		self.emit('exit', code || 0)
	}

	console.log('ok - command: ' + cmd + ' ' + shellQuote(args) + " (pid: " + this.pid + ")")
}

util.inherits(FakeProcess, EventEmitter)


FakeProcess.pid = 1000;
FakeProcess.expected = [];
FakeProcess.expect = function (expectation) {
	if (FakeProcess.expected.length === 0) {
		// start of test
		FakeProcess.started = new Date
	}
	FakeProcess.expected.push(expectation);
};

FakeProcess.finished = function (msg) { 
	var remaining = FakeProcess.expected;
	FakeProcess.expected = [];
	assert.deepEqual(remaining, [])
	console.log('ok - ' + (msg || 'ok - all expected calls received'))
}


function FakeTransport () {
	// singleton grosss
	if (FakeTransport.inst) return FakeTransport.inst;

	FakeTransport.inst = this;

	var expected = [];

	this.sendMail = function (opts) {
		var expectation = expected.shift();
		if (!expectation) {
			throw new Error("Unexpected call to sendMail: " + util.format(opts));
		}
		if (typeof expectation === 'function') return expectation(opts);

		['to', 'from', 'subject', 'text'].forEach(function (key) {
			assert.equal(opts.subject, expectation.subject)
		})

		console.log("ok - email is correct");
	};

	this.finished = function () {
		assert.deepEqual(expected, []);
	};

	this.expect = function (opts) {
		expected.push(opts);
	};
}

