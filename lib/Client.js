var _ = require('lodash');
var fetch = require('node-fetch');
var FormData = require('form-data');
var url = require('url');
var util = require('util');
var vow = require('vow');

var DEFAULT_OPTS = {
    timeout: 0,
    logFn: function () {},
    useOperationId: true,
    operationNameGenerator: function (operation, path) {
        return operation.toUpperCase() + ' ' + path;
    }
};

var isNotVendorExt = Function.prototype.call.bind(RegExp.prototype.test, /^(?!x-)/);

function indentMessage(message, indent) {
    return String(message).split('\n').map(function (messageStr) {
        return indent + messageStr;
    }).join('\n');
}

var Client = module.exports = function (spec, specUrl, options) {
    this._options = _.assign({}, DEFAULT_OPTS, options);

    var specUrlParsed = url.parse(specUrl);

    this._baseUrl = url.format({
        protocol: Array.isArray(spec.schemes) ?
            spec.schemes[0] :
            specUrlParsed.protocol,
        hostname: spec.host || specUrlParsed.hostname,
        pathname: spec.basePath || specUrlParsed.pathname
    });

    this.ops = this._buildOps(spec);

    // Convenient structures for parametrs validation.
    this._requiredParamsLists = this._buildRequiresParamsList(spec);
    this._paramsByType = this._buildParamsByType(spec);
    this._paramsByName = this._buildParamsByName(spec);
};

_.assign(Client.prototype, {

    _buildOps: function (spec) {
        return _(spec.paths)
            .pick(function (pathSpec, path) {
                // We don't know anything about properties that are vendor
                // extensions. Thus we omit them.
                return isNotVendorExt(path);
            })
            .map(function (pathSpec, path) {
                return _(pathSpec)
                    .pick(function (obj, key) {
                        // Spec of a path also contains parameters for all
                        // operations. We need to omit them.
                        return key !== 'parameters';
                    })
                    .reduce(function (ops, operationSpec, operation) {
                        ops[this._getOperationName(operation, path, operationSpec)] =
                            this._createOperationFn(operation, path);
                        return ops;
                    }, {}, this)
            }, this)
            .reduce(_.assign, {});
    },

    _buildRequiresParamsList: function (spec) {
        return _(spec.paths)
            .pick(function (pathSpec, path) {
                // We don't know anything about properties that are vendor
                // extensions. Thus we omit them.
                return isNotVendorExt(path);
            })
            .mapValues(function (pathSpec) {
                var pathParamsByName = _(pathSpec.parameters)
                    .groupBy('name')
                    .mapValues(_.first)
                    .value();

                return _(pathSpec)
                    .pick(function (obj, key) {
                        // Spec of a path also contains parameters for all
                        // operations. We need to omit them.
                        return key !== 'parameters';
                    })
                    .mapValues(function (operationSpec) {
                        var operationParamsByName = _(operationSpec.parameters)
                            .groupBy('name')
                            .mapValues(_.first)
                            .value();

                        return _({})
                            .assign(pathParamsByName)
                            .assign(operationParamsByName)
                            .filter('required')
                            .map('name')
                            .value();
                    })
                    .value();
            })
            .value();
    },

    _buildParamsByType: function (spec) {
        return _(spec.paths)
            .pick(function (pathSpec, path) {
                // We don't know anything about properties that are vendor
                // extensions. Thus we omit them.
                return isNotVendorExt(path);
            })
            .mapValues(function (pathSpec, path) {
                return _(pathSpec)
                    .pick(function (obj, key) {
                        // Spec of a path also contains parameters for all
                        // operations. We need to omit them.
                        return key !== 'parameters';
                    })
                    .mapValues(function (operationSpec) {
                        return _(operationSpec.parameters)
                            .groupBy('in')
                            .mapValues(function (params) {
                                return _.map(params, 'name');
                            })
                            .value();
                    })
                    .value();
            }, this)
            .value();
    },

    _buildParamsByName: function (spec) {
        return _(spec.paths)
            .pick(function (pathSpec, path) {
                // We don't know anything about properties that are vendor
                // extensions. Thus we omit them.
                return isNotVendorExt(path);
            })
            .mapValues(function (pathSpec, path) {
                return _(pathSpec)
                    .pick(function (obj, key) {
                        // Spec of a path also contains parameters for all
                        // operations. We need to omit them.
                        return key !== 'parameters';
                    })
                    .mapValues(function (operationSpec) {
                        return _(operationSpec.parameters)
                            .groupBy('name')
                            .mapValues(_.first)
                            .value();
                    })
                    .value();
            }, this)
            .value();
    },

    _getOperationName: function (operation, path, operationSpec) {
        var options = this._options;
        if (options.useOperationId && operationSpec.operationId) {
            return operationSpec.operationId;
        } else {
            return options.opsNameGenerator(operation, path);
        }
    },

    _createOperationFn: function (operation, path) {
        return this._performOperation.bind(this, operation, path);
    },

    _performOperation: function (operation, path, params) {
        // First we check presence of all required parameters.
        var missingParams = this._getMissingParams(operation, path, params);
        if (missingParams.length) {
            return vow.reject(new Error('Missing params: ' + missingParams.join(', ')));
        }

        var fetchUrl = this._getOperationFetchUrl(operation, path, params);
        var fetchOptions = this._getOperationFetchOpts(operation, path, params);

        this._options.logFn(util.format(
            'Request %s %s with headers:\n%s\nand body:\n%s',
            fetchOptions.method,
            fetchUrl,
            indentMessage(JSON.stringify(fetchOptions.headers), '    '),
            indentMessage(fetchOptions.body, '    ')
        ));

        return fetch(fetchUrl, fetchOptions)
            .then(function (res) {
                return res.json();
            });
    },

    _getMissingParams: function (operation, path, params) {
        return _.difference(
            this._requiredParamsLists[path][operation],
            _.keys(params)
        );
    },

    _getOperationFetchUrl: function (operation, path, params) {
        return this._baseUrl +
            this._getOperationPath(operation, path, params) +
            this._getOperationQueryString(operation, path, params);
    },

    _getOperationFetchOpts: function (operation, path, params) {
        // TODO
        // Process header parameters

        var opts = {
            body: undefined,
            headers: {},
            method: operation.toUpperCase(),
            timeout: this._options.timeout
        };

        var bodyParameters = this._paramsByType[path][operation].body;
        if (bodyParameters && params[bodyParameters[0]]) {
            opts.body = JSON.stringify(params[bodyParameters[0]]);
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer(opts.body).length;
        }

        // FIXME
        // Process formData parameters
        var formDataParameters = this._paramsByType[path][operation].formData;
        if (
            formDataParameters &&
            formDataParameters.some(function (param) {
                return param in params;
            })
        ) {
            opts.body = new FormData();
            formDataParameters.forEach(function (param) {
                if (param in params) {
                    opts.body.append(param, params[param]);
                }
            });
            _.assign(opts.headers, opt.body.getCustomHeaders());
        }

        return opts;
    },

    _getOperationPath: function (operation, path, params) {
        // Here we rely upon an assumption that set of path parameters in the
        // spec is consistent with the one in the path itself.
        return path.replace(/\{([^}]+)\}/, function (match, paramName) {
            return params[paramName];
        });
    },

    _getOperationQueryString: function (operation, path, params) {
        var queryParamNames = this._paramsByType[path][operation].query;
        return url.format({
            query: _.pick(params, function (value, name) {
                return _.includes(queryParamNames, name);
            })
        });
    }
});
