/**
 * Module dependencies.
 */

var require = require;
if(typeof patchRequire != 'undefined'){
  require = patchRequire;
}

var Base;
if(typeof Mocha != 'undefined'){
  Base = Mocha.reporters.Base;
} else {
  Base = require('mocha').reporters.Base;
}

var cursor = Base.cursor
    , color = Base.color
    , fs = require('fs')
    , path = require('path')
    , diff= require('diff')
    , mkdirp = require('mkdirp');

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */

var Date = global.Date
    , setTimeout = global.setTimeout
    , setInterval = global.setInterval
    , clearTimeout = global.clearTimeout
    , clearInterval = global.clearInterval;

/**
 * Expose `Jenkins`.
 */

exports = module.exports = Jenkins;

/**
 * Initialize a new `Jenkins` test reporter.
 *
 * @param {Runner} runner
 * @api public
 */

function Jenkins(runner, options) {
  Base.call(this, runner);
  var self = this,
      options = (options && options.reporterOptions) || {};
  var fd, currentSuite, lastSuiteTitle;

  // Default options
  options.junit_report_stack = process.env.JUNIT_REPORT_STACK || options.junit_report_stack;
  options.junit_report_path = process.env.JUNIT_REPORT_PATH || options.junit_report_path;
  options.junit_report_name = process.env.JUNIT_REPORT_NAME || options.junit_report_name || 'Mocha Tests';
  options.junit_report_fileName = options.junit_report_fileName || new Date().getTime();
  options.jenkins_reporter_enable_sonar = process.env.JENKINS_REPORTER_ENABLE_SONAR || options.jenkins_reporter_enable_sonar;
  options.jenkins_reporter_test_dir =  process.env.JENKINS_REPORTER_TEST_DIR || options.jenkins_reporter_test_dir  || 'test';

  function writeString(str) {
    if (fd) {
      if (typeof casper == "undefined") {
        // Node js only
        var buf = new Buffer(str);
        fs.writeSync(fd, buf, 0, buf.length, null);
      }
    } else if (typeof casper != "undefined") {
      process.stdout.write(str + '\n');
    }
  }

  function GetFullTitle(){
    if (this.parent) {
      var full = this.parent.fullTitle();
      if (full) return full + this.title;
    }
    return this.title;
  }

  function genSuiteReport() {
    var testCount = currentSuite.failures+currentSuite.passes;
    if (currentSuite.tests.length > testCount) {
      // we have some skipped suites included
      testCount = currentSuite.tests.length;
    }

    if (testCount === 0) {
      // no tests, we can safely skip printing this suite
      return;
    }

    writeString(tag('testsuite', {
      name: htmlEscape(currentSuite.suite.fullTitle()),
      tests: testCount,
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
    currentSuite.suite.fullTitle = GetFullTitle;
    console.log();
    console.log('Suite title: ' + suite.fullTitle());
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

    if (options.junit_report_stack && err.stack) {
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

  function getClassName(test, suite) {
    var title = suite.fullTitle();
    if (options.jenkins_reporter_enable_sonar) {
      // Inspired by https://github.com/pghalliday/mocha-sonar-reporter
      var relativeTestDir = options.jenkins_reporter_test_dir,
          absoluteTestDir = path.join(process.cwd(), relativeTestDir),
          relativeFilePath = path.relative(absoluteTestDir, test.file),
          fileExt = path.extname(relativeFilePath);
      title = relativeFilePath.replace(new RegExp(fileExt+"$"), '');
    }
    return htmlEscape(title);
  }

  runner.on('start', function() {
    var reportPath = options.junit_report_path;
    var suitesName = options.junit_report_name;
    if (reportPath) {
      if (fs.existsSync(reportPath)) {
        var isDirectory = fs.statSync(reportPath).isDirectory();
        if (isDirectory) reportPath = path.join(reportPath, options.junit_report_fileName + ".xml");
      } else {
        mkdirp.sync(path.dirname(reportPath));
      }
      console.log("write to reportPath: " + reportPath);

      console.log("Node Open File to write");
      fd = fs.openSync(reportPath, 'w');
    }
    writeString(tag('testsuites', {
      name: suitesName
    }, false));
  });

  runner.on('end', function() {
    endSuite();
    writeString('</testsuites>\n');
    if (fd){
      if(typeof casper == "undefined") {
        // Node js only
        fs.closeSync(fd);
      }
    }
    self.epilogue.call(self);
  });

  runner.on('suite', function (suite) {
    if (currentSuite) {
      endSuite();
    }
    startSuite(suite);
  });


  runner.on('test end', function(test) {
    addTestToSuite(test);
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

Jenkins.prototype.__proto__ = Base.prototype;
