var
  fs = require('fs'),
  path = require('path'),
  LRU = require('lru-cache'),
  async = require('async'),
  extend = require('xtend'),
  lruOptions = {
    max: 24000,
    length: function (n) { return n.length * 2 },
    dispose: function (key, n) { console.log(key, ' Dropped from LRU'); },
    maxAge: 1000 * 60 * 60
  },
  cache;

function getExtension(filename) {
  var ext = path.extname(filename||'').split('.');
  return ext[ext.length - 1];
}  

function segmentFlow(config) {
  var
    getSegments;
  
  if (!config.parsers) {
    config.parsers = {};
  }
  if (!config.lru) {
    config.lru = {}
  }
  cache = LRU(extend(config.lru, lruOptions));
  
  getSegments = function(segmentsKeyArray, done) {
    var
      toDo = [];
    segmentsKeyArray.forEach(function(aKey){
      if (config.hardCoded[aKey]) {
        toDo.push(function(cb) {
          var toPass = {};
          
          toPass[aKey] = config.hardCoded[aKey]
          cb(null, toPass);
        })
      } else if (cache.has(aKey)) {
        toDo.push(function(cb) {
          var toPass = {};
          
          toPass[aKey] = cache.get(aKey);
          cb(null, toPass);
        });
      } else {
        toDo.push(function(cb) {
          fs.readFile(config.segmentsPath+aKey, 'utf8', function(err, data) {
            var
              toPass = {},
              addToCache = function(err, newData) {
                toPass[aKey] = newData;
                cache.set(aKey, newData);
                console.log('Added ',aKey,' - New LRU Size:', cache._length);
                cb(null, toPass);
              };
            if (err) {
              toPass[aKey] = aKey+' segment not found'
              cb(null, toPass);
            } else {
              if (config.parsers[path.extname(aKey)]) {
                config.parsers[path.extname(aKey)](data, addToCache);
              } else {
                addToCache(null,data);
              }
            }
          });
        });
      }
    });
    
    async.parallel(toDo, function(err, values) {
      var
        responseObj = {};

      responseObj = extend.apply(responseObj, values);
      done(null, responseObj);
    });
  };
  
  function buildPage(template, relevantSegements, valueInsertFunction, doneFunction) {
    return function(req,res) {
      if (!doneFunction) {
        doneFunction = function(err, results) {
          if (err) {
            res.send(500, err);
          } else {
            console.log(req.protocol + '://' + req.get('host') + req.originalUrl, 'OK');
          }
        }
      }
      
      async.waterfall([
        function(cb) { getSegments(relevantSegements, cb) },
        function(fetchedSegements,cb) {
          template.render(valueInsertFunction(fetchedSegements), cb);
        },
        function(html, cb) {
          res.send(html)
          cb(null, html);
        }
      ],
      doneFunction);
    }
  };
  
  return {
    wfGetSegments  : function(segmentsKeyArray) {
      return function(cb) { getSegments(segmentsKeyArray, cb) }
    },
    getSegments    : getSegments,
    buildPage      : buildPage,
    cache          : cache
  };
}
  
module.exports = segmentFlow;