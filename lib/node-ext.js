/*****************************************************************
 * EXTENSIONS
 *****************************************************************/

/**
 * Calculate the amount of time from the date until now.  Only
 * returns the most significant unit (day/hour/minute/second),
 * rounded down.
 */
Date.prototype.fromNow = function() {
	var now = new Date();
	var diff = parseInt((now.getTime() - this.getTime()) / 1000);
	var d = parseInt(diff / 86400); diff -= d * 86400;
	var h = parseInt(diff / 3600);  diff -= h * 3600;
	var m = parseInt(diff / 60);    diff -= m * 60;
	var s = diff;
	if(d > 0) return d+" day"+(d > 1 ? 's' : '')+" ago";
	if(h > 0) return h+" hour"+(h > 1 ? 's' : '')+" ago";
	if(m > 0) return m+" minute"+(m > 1 ? 's' : '')+" ago";
	if(s > 0) return s+" second"+(s > 1 ? 's' : '')+" ago";
	return "now";
};

/**
 * Trim the first part of a string up to the first occurrence of
 * a character.  Return the whole string if the character is not found.
 */
String.prototype.trimTo = function(c) {
	return this.indexOf(c) > -1 ? this.substring(0, this.indexOf(c)) : this;
};

/**
 * Append one array to another
 */
Array.prototype.append = function(a) {
	for(var i = 0; i < a.length; i++) {
		this.push(a[i]);
	}
};

/**
 * Prepend one array to another
 */
Array.prototype.prepend = function(a) {
	for(var i = a.length-1; i >= 0; i--) {
		this.unshift(a[i]);
	}
};

/**
 * sprintf and vsprintf for Javascript
 * based on Copyright (c) 2008 Sabin Iacob (m0n5t3r) <iacobs@m0n5t3r.info>
 * which is somewhat based on http://jan.moesen.nu/code/javascript/sprintf-and-printf-in-javascript/
 * 
 * GPL-licensed.
 */
var sprintf = {
	formats: {
		'%': function(val) {return '%';},
		'b': function(val) {return  parseInt(val, 10).toString(2);},
		'c': function(val) {return  String.fromCharCode(parseInt(val, 10));},
		'd': function(val) {return  parseInt(val, 10) ? parseInt(val, 10) : 0;},
		'u': function(val) {return  Math.abs(val);},
		'f': function(val, p) {return  (p > -1) ? Math.round(parseFloat(val) * Math.pow(10, p)) / Math.pow(10, p): parseFloat(val);},
		'o': function(val) {return  parseInt(val, 10).toString(8);},
		's': function(val) {return  val;},
		'x': function(val) {return  ('' + parseInt(val, 10).toString(16)).toLowerCase();},
		'X': function(val) {return  ('' + parseInt(val, 10).toString(16)).toUpperCase();}
	},

	re: /%(?:(\d+)?(?:\.(\d+))?|\(([^)]+)\))([%bcdufosxX])/g,

	dispatch: function(data){
		if(data.length == 1 && typeof data[0] == 'object') { //python-style printf
			data = data[0];
			return function(match, w, p, lbl, fmt, off, str) {
				with(sprintf) return formats[fmt](data[lbl]);
			};
		} else { // regular, somewhat incomplete, printf
			var idx = 0; // oh, the beauty of closures :D
			return function(match, w, p, lbl, fmt, off, str) {
				with(sprintf) return formats[fmt](data[idx++], p);
			};
		}
	},

	sprintf: function(format) {
		var argv = Array.apply(null, arguments).slice(1);
		with(sprintf) return format.replace(re, dispatch(argv));
	},

	vsprintf: function(format, data) {
		with(sprintf) return format.replace(re, dispatch(data));
	}
};
exports.sprintf  = sprintf.sprintf;
exports.vsprintf = sprintf.vsprintf;
String.prototype.sprintf = function() {
	return sprintf.vsprintf(this, arguments);
};
String.prototype.vsprintf = function(args) {
	return sprintf.vsprintf(this, args);
}

/*
 * Date Format 1.2.3
 * (c) 2007-2009 Steven Levithan <stevenlevithan.com>
 * MIT license
 *
 * Includes enhancements by Scott Trenda <scott.trenda.net>
 * and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to dateFormat.masks.default.
 *
 * See <http://blog.stevenlevithan.com/archives/date-time-format> for docs
 */
var dateFormat = function () {
	var	token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
		timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
		timezoneClip = /[^-+\dA-Z]/g,
		pad = function (val, len) {
			val = String(val);
			len = len || 2;
			while (val.length < len) val = "0" + val;
			return val;
		};

	// Regexes and supporting functions are cached through closure
	return function (date, mask, utc) {
		var dF = dateFormat;

		// You can't provide utc if you skip other args (use the "UTC:" mask prefix)
		if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
			mask = date;
			date = undefined;
		}

		// Passing date through Date applies Date.parse, if necessary
		date = date ? new Date(date) : new Date;
		if (isNaN(date)) throw SyntaxError("invalid date");

		mask = String(dF.masks[mask] || mask || dF.masks["default"]);

		// Allow setting the utc argument via the mask
		if (mask.slice(0, 4) == "UTC:") {
			mask = mask.slice(4);
			utc = true;
		}

		var	_ = utc ? "getUTC" : "get",
			d = date[_ + "Date"](),
			D = date[_ + "Day"](),
			m = date[_ + "Month"](),
			y = date[_ + "FullYear"](),
			H = date[_ + "Hours"](),
			M = date[_ + "Minutes"](),
			s = date[_ + "Seconds"](),
			L = date[_ + "Milliseconds"](),
			o = utc ? 0 : date.getTimezoneOffset(),
			flags = {
				d:    d,
				dd:   pad(d),
				ddd:  dF.i18n.dayNames[D],
				dddd: dF.i18n.dayNames[D + 7],
				m:    m + 1,
				mm:   pad(m + 1),
				mmm:  dF.i18n.monthNames[m],
				mmmm: dF.i18n.monthNames[m + 12],
				yy:   String(y).slice(2),
				yyyy: y,
				h:    H % 12 || 12,
				hh:   pad(H % 12 || 12),
				H:    H,
				HH:   pad(H),
				M:    M,
				MM:   pad(M),
				s:    s,
				ss:   pad(s),
				l:    pad(L, 3),
				L:    pad(L > 99 ? Math.round(L / 10) : L),
				t:    H < 12 ? "a"  : "p",
				tt:   H < 12 ? "am" : "pm",
				T:    H < 12 ? "A"  : "P",
				TT:   H < 12 ? "AM" : "PM",
				Z:    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
				o:    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
				S:    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
			};

		return mask.replace(token, function ($0) {
			return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
		});
	};
}();

// Some common format strings
dateFormat.masks = {
	"default":      "ddd mmm dd yyyy HH:MM:ss",
	shortDate:      "m/d/yy",
	mediumDate:     "mmm d, yyyy",
	longDate:       "mmmm d, yyyy",
	fullDate:       "dddd, mmmm d, yyyy",
	shortTime:      "h:MM TT",
	mediumTime:     "h:MM:ss TT",
	longTime:       "h:MM:ss TT Z",
	isoDate:        "yyyy-mm-dd",
	isoTime:        "HH:MM:ss",
	isoDateTime:    "yyyy-mm-dd'T'HH:MM:ss",
	isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
};

// Internationalization strings
dateFormat.i18n = {
	dayNames: [
		"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
		"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
	],
	monthNames: [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
		"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
	]
};

// For convenience...
Date.prototype.format = function (mask, utc) {
	return dateFormat(this, mask, utc);
};
exports.dateFormat = dateFormat;
