/**
 * Test Runner for Custodian.
 */

if (require.main === module) {
	if (process.argv.length === 2) runTests(['core'])
	else runTests(process.argv.slice(2));
}

function runTests (suites) {
	var i = 0;

	(function nextSuite () {

		var suiteName = suites[i++];
		if (!suiteName) return;

		var suite = require('./test/' + suiteName + '.test.js')
			, tests = Object.keys(suite).filter(isTestName)
			, j = 0

		function nextTest (message) {
			var test = tests[j++];
			if (!test) {
				if (suite.after) suite.after();
				return nextSuite();
			}
			console.log('\n## Test case: ' + test)
			var args = [];
			if (suite.beforeEach) suite.beforeEach(args);
			args.push(done);
			suite[test].apply(null, args)

			function done (message) {
				if (suite.afterEach) suite.afterEach(message, args);
				nextTest()
			}
		}

		console.log("# Suite: " + suiteName);
		if (suite.before) suite.before();
		nextTest()
	})()
}

function isTestName (name) {
	return name !== 'before'
		&& name !== 'after'
		&& name !== 'beforeEach'
		&& name !== 'afterEach';
}

