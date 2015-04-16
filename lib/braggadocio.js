var assert = require('assert');
var fetch = require('node-fetch');
var vow = require('vow');

// Set `fetch` promises to `vow.Promise`
fetch.Promise = vow.Promise;

var Client = require('./Client');

exports.createClientFromUrl = function (specUrl, options) {
    return fetch(specUrl)
        .then(function (res) {
            return res.json();
        })
        .then(function (spec) {
            return new Client(spec, specUrl, options);
        });
};

exports.createClientFromSpec = function (spec, options) {
    if (!spec.hostname) {
        return vow.reject(new Error('Property `hostname` MUST exist in the spec'));
    }
    return vow.resolve(new Client(spec, '', options);
};
