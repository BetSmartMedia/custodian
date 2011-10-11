/* Copyright (c) 2009 Marak Squires - www.maraksquires.com
 
Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:
 
The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.
 
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
*/

/* Fixed by Judd, 2010-02-15 */
/* Updated for Node 0.1.30, 2010-02-27 */

/********* USAGE ***********

	var email = require("./node_mailer");
	email.send({
	  to : "marak.squires@gmail.com",
	  from : "obama@whitehouse.gov",
	  subject : "node_mailer test email",
	  body : "hello this is a test email from the node_mailer"
	});
	
****************************/

var net = require('net');
var sys = require('sys');

var email = {
  send:function (options, cb){
		var options     = typeof(options)         == "undefined" ? {} : options;
		options.to      = typeof(options.to)      == "undefined" ? "example@example.com" : options.to;
		options.from    = typeof(options.from)    == "undefined" ? "noreply@example.com" : options.from;
		options.subject = typeof(options.subject) == "undefined" ? "no subject" : options.subject;
		options.body    = typeof(options.body)    == "undefined" ? "" : options.body;	
			
		var self = this;
		var cb = cb || function(){};

		this.connection = net.createConnection(25);
		this.connection.addListener("connect", function (socket) {
			self.connection.write("HELO localhost\r\n");
			self.connection.write("MAIL FROM: " + options.from + "\r\n");
			self.connection.write("RCPT TO: " + options.to + "\r\n");
			self.connection.write("DATA\r\n");
			self.connection.write("From: " + options.from + "\r\n");
			self.connection.write("To: " + options.to + "\r\n");
			self.connection.write("Subject: " + options.subject + "\r\n");
			// don't use this unless you need to, it triggers spam traps
			//self.connection.write("Content-Type: text/plain\r\n");
			self.connection.write(email.wordwrap(options.body) + "\r\n");
			self.connection.write(".\r\n");
			self.connection.write("QUIT\r\n");
			self.connection.end();
		});

		var output = '';

		this.connection.addListener("receive", function (data) {
			output += data;
		});
		this.connection.addListener("eof", function(){
			if(email.parseResponse(output)){
				cb(null);
			}else{
				sys.puts(sys.inspect(arguments));
				cb(true);
			}
		});
	},

  parseResponse:function(data){
		var success = false;
		var d = data.split("\r\n");
		d.forEach(function(itm){
			// not sure if all MTAs respond with "250 2.0.0" but Sendmail and Postfix do
			if(/^250 2\.0\.0/.test(itm)) success = true;
		});
		return success;
  },
  
  wordwrap:function(str){
		var m = 80;
		var b = "\r\n";
		var c = false;
		var i, j, l, s, r;
		str += '';
		if (m < 1) {
			return str;
		}
		for (i = -1, l = (r = str.split(/\r\n|\n|\r/)).length; ++i < l; r[i] += s) {
			for(s = r[i], r[i] = ""; s.length > m; r[i] += s.slice(0, j) + ((s = s.slice(j)).length ? b : "")){
				j = c == 2 || (j = s.slice(0, m + 1).match(/\S*(\s)?$/))[1] ? m : j.input.length - j[0].length || c == 1 && m || j.input.length + (j = s.slice(m).match(/^\S*/)).input.length;
			}
		}
		return r.join("\n");
	}
}

exports.send = email.send;
