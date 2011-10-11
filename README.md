## Janitor

It keeps the things running at the right intervals. But different than cron.

Janitor is built on NodeJS.

With Janitor, you can schedule commands to run at specific intervals (eg,
every 30 seconds). You can also schedule commands to run after other
commands have completed.

At Bet Smart, we use the Janitor to run a number of post-processing
tasks after a data feed has been consumed.

Janitor also provides basic watchdog capabilities.  If a process dies,
Janitor will restart it and notify the admin.

