/**
 * Specialized mocks for child processes and email for use in unit tests.
 */
util         = require('util')
assert       = require('assert')
EventEmitter = require('events').EventEmitter
Stream       = require('stream').Stream
shellQuote   = require('shell-quote').quote

exports.FakeProcess = FakeProcess

exports.FakeTransport = FakeTransport

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
	this.pid    = FakeProcess.pid++;

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
	var expected = [];

	this.sendMail = function (opts) {
		assert.deepEqual(opts, expected.shift());
	};

	this.finished = function () {
		assert.deepEqual(expected, []);
	};

	this.expect = function (opts) {
		expected.push(opts);
	};
}
