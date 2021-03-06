'use strict';

var _ = require('lodash');
var fs = require('fs');
var format = require('string-format');
var path = require('path');

var Corro = function (rules) {
  var ruleDir = path.join(__dirname, 'lib/rules');
  this.rules = rules || {};

  var defaults = fs.readdirSync(ruleDir)
    .filter(function (file) { return file.match(/\.js$/); })
    .reduce(function (acc, file) {
      acc[path.basename(file, '.js')] = require(path.resolve(ruleDir, file));

      return acc;
    }, {});

  this.rules = _.assign(defaults, this.rules);

  return this;
};

function shouldRun(rule, val, args) {
  return (rule.evaluateNull || val !== null) &&
    (rule.evaluateUndefined || val !== undefined) &&
    (rule.alwaysRun || args !== false);
}

Corro.prototype.runRule = function (ctx, rule, val, args) {
  // if we've been given a name instead of a rule block (from eg conform), look it up
  if (!_.isPlainObject(rule)) {
    rule = this.rules[rule];

    if (!rule) { return ['invalid rule specified']; }
  }

  if (shouldRun(rule, val, args)) {
    if (args === undefined) { args = []; }
    if (rule.argArray) { args = [args]; }

    var func = rule.func || rule;   // for custom rule blocks

    var result = func.apply({
      runRule: this.runRule,
      context: ctx
    }, [val].concat(args));

    if (_.isBoolean(result) && !result) {
      return [format.apply(this, [rule.message].concat(args))];
    } else if (_.isArray(result)) { // message array from conform
      return result;
    }
  }

  return [];
};

Corro.prototype.evaluateObject = function (ctx, schema, val, name) {
  var self = this;

  return _.transform(schema, function (result, args, key) {
    if (!_.isPlainObject(args)) {  // rule
      var res = {
        rule: key,
        result: self.runRule(ctx, key, val, args)
      };

      var len = res.result.length;

      if (len > 0) {
        if (self.rules[key].includeArgs !== false) { res.args = args; }

        var formatStr = len > 1 ? '{}-{}' : '{}';

        name = name || '*';   // nicer than "undefined" as a key for results on the root context

        result[name] = (result[name] || []).concat(res.result.map(function (r, idx) {
          res.rule = format(formatStr, key, idx);
          res.result = r;

          return _.clone(res);
        }));
      }
    } else if (!!val) {  // child object
      if (_.isArray(val)) {
        return val.map(function (element, idx) {
          _.mergeWith(
            result,
            self.evaluateObject(val, args, element, name + '.' + idx),
            function (a, b) {
              if (_.isArray(a)) { return a.concat(b); } // merge all results if multiple subschemata provided
              return b;
            });
        });
      } else {
        var child = name ? name + '.' + key : key;

        _.merge(result, self.evaluateObject(val, args, val[key], child));
      }
    }
  });
};

Corro.prototype.validate = function (schema, obj) {
  var results = this.evaluateObject(obj, schema, obj);

  return {
    valid: Object.keys(results).length === 0,
    errors: results
  };
};

exports = module.exports = Corro;
