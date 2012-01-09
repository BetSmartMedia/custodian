## Janitor

Janitor is a program somewhat similar to cron.  Unlike cron, Janitor
cannot run programs at specific times, only at intervals (eg, every 5
minutes, or every 2 seconds).

Janitor has a unique spin, however: It can also run programs *after*
another program has completed. This is quite useful in scenarios where you
have a number of programs that need to be run at regular intervals and in
a specific order.

In addition to relative scheduling, Janitor also provides basic watchdog
capabilities. When Janitor starts up, it will start all watched processes,
and if one dies, it will attempt to restart it and notify you.


### Example: Scheduling

Say you have a script that fetches an external XML data feed, processes
it, and loads it into your local database.  Once the ETL process is
complete, you want to perform some post-processing actions on it.

This is an ideal use case for Janitor.  You can accomplish this with the
following configuration excerpt:

```
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

```
{
	"admin": "admin@example.com",

	"daemon": true,
	"log": "janitor.log",
	"pid": "janitor.pid",

	"watch": {
		"watch1": {"cmd":"watch_me.sh", "notify":true, "output":"watch1.log"}
	}
}
```

