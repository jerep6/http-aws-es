/**
 * A Connection handler for Amazon ES.
 *
 * Uses the aws-sdk to make signed requests to an Amazon ES endpoint.
 * Define the Amazon ES config and the connection handler
 * in the client configuration:
 *
 * var es = require('elasticsearch').Client({
 *  hosts: 'https://amazon-es-host.us-east-1.es.amazonaws.com',
 *  connectionClass: require('http-aws-es'),
 *  amazonES: {
 *    region: 'us-east-1',
 *    accessKey: 'AKID',
 *    secretKey: 'secret',
 *    credentials: new AWS.EnvironmentCredentials('AWS') // Optional
 *  }
 * });
 *
 * @param client {Client} - The Client that this class belongs to
 * @param config {Object} - Configuration options
 * @param [config.protocol=http:] {String} - The HTTP protocol that this connection will use, can be set to https:
 * @class HttpConnector
 */

module.exports = function (AWS) {
  let HttpConnector = require('elasticsearch/src/lib/connectors/http')
  let _ = require('elasticsearch/src/lib/utils');
  let zlib = require('zlib');

  return class HttpAmazonESConnector extends HttpConnector {
    constructor(host, config) {
      super(host, config);
      this.endpoint = new AWS.Endpoint(host.host);
      this.endpoint = new AWS.Endpoint(host.host);
      this.region = this.getRegion(config.amazonES);
      this.creds = this.getCredentials(config.amazonES);
      this.httpOptions = this.getHttpOptions(config.amazonES);
    }

    getRegion(amazonES) {
      if (amazonES && amazonES.region) {
        return amazonES.region;
      } else {
        return AWS.config.region;
      }
    }
    getCredentials(amazonES) {
      return new Promise((resolve, reject) => {
        if (amazonES && amazonES.credentials) {
          resolve(amazonES.credentials);
        } else if(amazonES && amazonES.accessKey && amazonES.secretKey) {
          resolve(new AWS.Credentials(amazonES.accessKey, amazonES.secretKey));
        } else {
          AWS.config.getCredentials((err, cred) => {
            if(err) reject(err);
            else resolve(cred);
          });
        }
      });
    }
    getHttpOptions(amazonES) {
      if(amazonES && amazonES.httpOptions) {
        return amazonES.httpOptions;
      } else {
        return AWS.config.httpOptions;
      }
    }

    request(params, cb) {
      return this.creds.then(creds => {
        var incoming;
        var timeoutId;
        var request;
        var req;
        var status = 0;
        var headers = {};
        var log = this.log;
        var response;

        var reqParams = this.makeReqParams(params);
        // general clean-up procedure to run after the request
        // completes, has an error, or is aborted.
        var cleanUp = _.bind(function (err) {
          clearTimeout(timeoutId);

          req && req.removeAllListeners();
          incoming && incoming.removeAllListeners();

          if ((err instanceof Error) === false) {
            err = void 0;
          }

          log.trace(params.method, reqParams, params.body, response, status);
          if (err) {
            cb(err);
          } else {
            cb(err, response, status, headers);
          }
        }, this);

        request = new AWS.HttpRequest(this.endpoint);

        // copy across params
        for (let p in reqParams) {
          request[p] = reqParams[p];
        }

        request.region = this.region;
        if (params.body) request.body = params.body;
        if (!request.headers) request.headers = {};
        request.headers['presigned-expires'] = false;
        request.headers['Host'] = this.endpoint.host;

        // Sign the request (Sigv4)
        var signer = new AWS.Signers.V4(request, 'es');
        signer.addAuthorization(creds, new Date());

        var send = new AWS.NodeHttpClient();
        req = send.handleRequest(request, this.httpOptions, function (_incoming) {
          incoming = _incoming;
          status = incoming.statusCode;
          headers = incoming.headers;
          response = '';

          var encoding = (headers['content-encoding'] || '').toLowerCase();
          if (encoding === 'gzip' || encoding === 'deflate') {
            incoming = incoming.pipe(zlib.createUnzip());
          }

          incoming.setEncoding('utf8');
          incoming.on('data', function (d) {
            response += d;
          });

          incoming.on('error', cleanUp);
          incoming.on('end', cleanUp);
        }, cleanUp);

        req.on('error', cleanUp);

        req.setNoDelay(true);
        req.setSocketKeepAlive(true);

        return function () {
          req.abort();
        };
      });
    }
  }
}
