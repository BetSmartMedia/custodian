exports.admin_email = 'admin@example.com';

/**
 * schedule: <arbitrary name> : { cmd:<what to run>, when:<when to run>, args:['last_run'] }
 * watch:    <arbitrary name> : { cmd:<what to run> }
 *
var APP_BASE = '/home/sites/myapp.com/htdocs';
exports.config = {
	schedule: {
		some_cmd:      {cmd:APP_BASE+'/app/bin/cmd.php', args:['last_run'], when:'every 300s'},
		another_cmd:   {cmd:APP_BASE+'/app/bin/cmd.py', when:'every 60s'},
		one_more_cmd:  {cmd:APP_BASE+'/app/bin/and_then.py', when:'after some_cmd'},
	},
	watch: {
		sketchy_cmd:   {cmd:APP_BASE+'/app/bin/sometimes_crashes.php', notify:true}
	}
};*/

/**
 * Testing
 */
exports.config = {
	schedule: {
		t: {cmd:'test/env.php', when:'every 2s'},
		job1: {cmd:'test/job1.sh', args:['last_run'], when:'every 2s'},
		job2: {cmd:'test/job2.sh', args:['last_run'], when:'after job1'},
		job3: {cmd:'test/job3.sh', args:['last_run'], when:'after job1'},
	},
	watch: {
		job1: {cmd:'test/job1.sh', notify:false}
	}
};
