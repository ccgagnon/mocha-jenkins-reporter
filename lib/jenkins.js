/**
 * Module dependencies.
 */

var Base = require('mocha').reporters.Base;
var color = Base.color;
var fs = require('fs');

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */

var Date = global.Date
  , setTimeout = global.setTimeout
  , setInterval = global.setInterval
  , clearTimeout = global.clearTimeout
  , clearInterval = global.clearInterval;

/**
 * Initialize a new `Jenkins` test reporter.
 *
 * @param {Runner} runner
 * @api public
 */

function Jenkins(runner) {
  Base.call(this, runner);

  var self = this;
  var fd, currentSuite;

  function writeString(str) {
    if (fd) {
      var buf = new Buffer(str);
      fs.writeSync(fd, buf, 0, buf.length, null);
    }
  }

  function genSuiteReport() {
    writeString(tag('testsuite', {
      name: currentSuite.suite.fullTitle(),
      tests: currentSuite.tests.length,
      failures: currentSuite.failures,
      skipped: currentSuite.skipped,
      timestamp: currentSuite.start.toUTCString(),
      time: (currentSuite.duration / 1000) || 0
    }, false));

    currentSuite.tests.forEach(function(test) {
      addTest(test);
    });

    writeString('</testsuite>\n');
  }

  function addTest(test) {
    var attrs = {
      classname: test.parent.fullTitle(),
      name: test.title,
      time: (test.duration / 1000) || 0
    };

    var innerTag = null;
    if (test.state === 'failed') {
      var err = test.err;
      attrs.message = err.message;
      innerTag = tag('failure', attrs, true, cdata(err.stack), true);
    } else if (test.pending) {
      innerTag = tag('skipped', null, true);
    }
    writeString(tag('testcase', attrs, true, innerTag, true));
  }

  function startSuite(suite) {
    currentSuite = {
      suite: suite,
      tests: [],
      start: new Date(),
      failures: 0,
      passes: 0,
      skipped: 0
    };
    console.log();
    console.log('  ' + suite.fullTitle());
  }

  function endSuite() {
    if (currentSuite !== null) {
      currentSuite.duration = new Date() - currentSuite.start;
      console.log();
      console.log('  Suite duration: '+(currentSuite.duration/1000)+' s, Tests: '+currentSuite.tests.length);
      try {
      genSuiteReport();
      } catch (err) {
        console.log(err);
      }
      currentSuite = null;
    }
  }

  function addTestToSuite(test, action) {
    checkForNewSuite(test);
    currentSuite.tests.push(test);
    var fmt = null;
    switch (action) {
    case 'pass':
      currentSuite.passes++;
      fmt = indent() + color('checkmark', '  ' + Base.symbols.dot) + color('pass', ' %s: ') + color(test.speed,
        '%dms');
      console.log(fmt, test.title, test.duration);
      break;
    case 'fail':
      var n = ++currentSuite.failures;
      fmt = indent() + color('fail', '  %d) %s');
      console.log(fmt, n, test.title);
      break;
    case 'pending':
      currentSuite.skipped++;
      fmt = indent() + color('checkmark', '  -') + color('pending', ' %s');
      console.log(fmt, test.title);
      break;
    }
  }

  function indent() {
    return '    ';
  }

  function tag(name, attrs, close, content, raw) {
    var pairs = [];
    var _tag;

    if (attrs) {
      for (var key in attrs) {
        if (attrs.hasOwnProperty(key)) {
          pairs.push(key + '="' + htmlEscape(attrs[key]) + '"');
        }
      }
    }

    _tag = '<' + name + (pairs.length ? ' ' + pairs.join(' ') : '') + '>';
    if (content) {
      _tag += raw ? content : htmlEscape(content);
    }
    if (close) _tag += '</' + name + '>\n';
    return _tag;
  }

  function htmlEscape(str) {
      return String(str)
      .replace(/\\/g, '\\\\') /* MUST be first */
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\u00A0/g, '\\u00A0')
      .replace(/&/g, '\\x26')
      .replace(/'/g, '\\x27')
      .replace(/"/g, '\\x22')
      .replace(/</g, '\\x3C')
      .replace(/>/g, '\\x3E');
  }

  function cdata(str) {
    return '<![CDATA[' + str + ']]>';
    }

  function unifiedDiff(err) {
    
	function isString(myVar){
		return typeof myVar === 'string' || myVar instanceof String
	};
	
	if (!err.actual || !err.expected || !isString(err.actual) || !isString(err.expected)) {
      return "";
    }
    function escapeInvisibles(line) {
      return line.replace(/\t/g, '<tab>')
                 .replace(/\r/g, '<CR>')
                 .replace(/\n/g, '<LF>\n');
    }
    function cleanUp(line) {
      if (line.match(/\@\@/)) return null;
      if (line.match(/\\ No newline/)) return null;
      return escapeInvisibles(line);
    }
    function notBlank(line) {
      return line != null;
    }

    var actual = err.actual,
        expected = err.expected;

    var lines, msg = '';

    if (err.actual && err.expected) {
      // make sure actual and expected are strings
      if (!(typeof actual === 'string' || actual instanceof String)) {
        actual = JSON.stringify(err.actual);
      }

      if (!(typeof expected === 'string' || expected instanceof String)) {
        expected = JSON.stringify(err.actual);
      }

      msg = diff.createPatch('string', actual, expected);
      lines = msg.split('\n').splice(4);
      msg += lines.map(cleanUp).filter(notBlank).join('\n');
    }

    if (err.stack) {
      if (msg) msg += '\n';
      lines = err.stack.split('\n').slice(1);
      msg += lines.map(cleanUp).filter(notBlank).join('\n');
    }

    return msg;
  }

  function checkForNewSuite(test) {
    if (test.parent.fullTitle() !== lastSuiteTitle) {
      endSuite();
      lastSuiteTitle = test.parent.fullTitle();
      startSuite(test.parent);
    }
  }

  runner.on('start', function() {
    var reportPath = process.env.JUNIT_REPORT_PATH;
    var suitesName = process.env.JUNIT_REPORT_NAME || 'Mocha Tests';
    if (reportPath) {
      var isDirectory = fs.existsSync(reportPath) && fs.statSync(reportPath).isDirectory();
      if (isDirectory) reportPath = path.join(reportPath, new Date().getTime() + ".xml"); 
      fd = fs.openSync(reportPath, 'w');
    }
    writeString(tag('testsuites', {
      name: 'Mocha Tests'
    }, false));
  });

  runner.on('end', function() {
    endSuite();
    writeString('</testsuites>\n');
    if (fd) fs.closeSync(fd);
    self.epilogue.call(self);
  });

  runner.on('pending', function(test) {
    addTestToSuite(test, 'pending');
  });

  runner.on('pass', function(test) {
    addTestToSuite(test, 'pass');
  });

  runner.on('fail', function (test) {
    addTestToSuite(test, 'fail');
  });
}

/**
 * Expose `Jenkins`.
 */

exports = module.exports = Jenkins;

Jenkins.prototype.__proto__ = Base.prototype;
