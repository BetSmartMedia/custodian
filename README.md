## Custodian

Custodian is a program somewhat similar to cron.  Unlike cron, Custodian
cannot run programs at specific times, only at intervals (eg, every 5
minutes, or every 2 seconds).

Custodian has a unique spin, however: It can also run programs *after*
another program has completed. This is quite useful in scenarios where you
have a number of programs that need to be run at regular intervals and in
a specific order.

In addition to relative scheduling, Custodian also provides basic watchdog
capabilities. When Custodian starts up, it will start all watched processes,
and if one dies, it will attempt to restart it and notify you.


### Example: Scheduling

Say you have a script that fetches an external XML data feed, processes
it, and loads it into your local database.  Once the ETL process is
complete, you want to perform some post-processing actions on it.

This is an ideal use case for Custodian.  You can accomplish this with the
following configuration excerpt:

```json
{
	"schedule": {
		"etl":       {"cmd":"etl.js", "when":"every 60s"},
		"postproc1": {"cmd":"pp1.js", "when":"after postproc1"},
		"postproc2": {"cmd":"pp2.js", "when":"after postproc1"}
	}
}
```

### Example: Watchdog

This excerpt will log all output from the watch_me.sh script to a file. If
the script dies, it will restart it and notify the administrator.

```json
{
	"admin": "admin@example.com",

	"daemon": true,
	"log": "custodian.log",
	"pid": "custodian.pid",

	"watch": {
		"watch1": {"cmd":"watch_me.sh", "notify":true, "output":"watch1.log"}
	}
}
```

### Example: Environment variables

To set environment variables that will apply to all jobs, you can use the
"env" key in your configuration:

```json
{
	"env": {
		"API_KEY": "abcdef1234567890"
	}
}
```

You can also specify environment variables inside `"schedule"` and `"watch"`
jobs:

```json
{
	"env": {
		"API_KEY": "abcdef1234567890"
	},
	"watch": {
		"web-server": {
			"cmd": "npm start myapp",
			"env": {
				"PORT": 1234
			}
		}
	}
}
```

Configuration environment variables override pre-existing environment variables,
and job-specific variables override both.
