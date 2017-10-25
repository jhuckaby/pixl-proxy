// PixlProxy Pool Object
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

var assert = require('assert');
var fs = require('fs');
var Path = require('path');
var http = require('http');
var net = require('net');
var async = require('async');
var StreamMeter = require("stream-meter");

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var Request = require("pixl-request");
var Perf = require("pixl-perf");

module.exports = Class.create({
	
	__name: 'Pool', // gets overridden with pool ID
	__parent: Component,
	
	defaultConfig: {
		"method_match": ".+",
		"host_match": ".*",
		"uri_match": ".+",
		"x_proxy_only": false,
		"target_protocol": "http",
		"target_port": "",
		"cache_dns_sec": 0,
		"max_concurrent_requests": 0,
		"max_requests_per_sec": 0,
		"max_queue_length": 0,
		"follow_redirects": false,
		"http_user_agent": "",
		"http_timeout_ms": 0,
		"http_basic_auth": false,
		"append_to_x_forwarded_for": true,
		"use_keep_alives": true,
		"retries": 0,
		"throttle_requeue_delay_ms": 100,
		"error_retry_delay_base_ms": 0,
		"error_retry_delay_mult_ms": 0,
		"error_retry_delay_max_ms": 0,
		"log_perf_ms": 0,
		"log_errors": true,
		"log_transactions": false,
		"resp_code_success_match": "^(2\\d\\d|3\\d\\d)$",
		"scrub_request_headers": "^(host|x\\-proxy|x\\-proxy\\-\\w+|expect|content\\-length|connection)$",
		"scrub_response_headers": "^(connection|transfer\\-encoding)$",
		"min_stream_size": 131072,
		"insert_request_headers": null,
		"insert_response_headers": null
	},
	
	agent: null,
	request: null,
	queue: null,
	perf: null,
	stats: null,
	lastCounters: null,
	lastMetrics: null,
	nextId: 1,
	
	getNextId: function(prefix) {
		// get unique ID with prefix
		return '' + prefix + Math.floor(this.nextId++);
	},
	
	startup: function() {
		// pool startup
		var self = this;
		
		// set up stats object
		this.stats = {
			num_pending: 0,
			max_pending: this.config.get('max_queue_length') || 0,
			num_executing: 0,
			max_executing: this.config.get('max_concurrent_requests') || 1,
			max_per_sec: this.config.get('max_requests_per_sec'),
			num_sockets: 0
		};
		
		// create agent for keep-alives
		this.agent = new http.Agent({
			keepAlive: !!this.config.get('use_keep_alives'),
			maxSockets: this.config.get('max_concurrent_requests') || 1,
			maxFreeSockets: this.config.get('max_concurrent_requests') || 1,
			// keepAliveMsecs: this.config.get('keep_alive_ping') || 1000
		});
		this.agent.createConnection = function(options) {
			// creating new socket
			var id = self.getNextId('p');
			self.logDebug(5, "Creating new proxy socket: " + id);
			
			var socket = net.createConnection(options);
			socket.on('close', function() {
				self.logDebug(5, "Proxy socket has closed: " + id);
				self.perf.count('sockets_closed', 1);
				self.stats.num_sockets--;
			});
			
			self.perf.count('sockets_opened', 1);
			self.stats.num_sockets++;
			return socket;
		};
		
		// setup request object
		this.request = new Request();
		this.request.setUserAgent( this.config.get('http_user_agent') );
		this.request.setTimeout( this.config.get('http_timeout_ms') );
		this.request.setFollow( this.config.get('follow_redirects') );
		this.request.setDNSCache( this.config.get('cache_dns_sec') );
		
		// prevent default Accept-Encoding header
		this.request.defaultHeaders = {};
		
		// do not auto-decompress responses (we want pure passthrough)
		this.request.setAutoDecompress( false );
		
		// precompile regexps
		this.req_head_scrub_regex = new RegExp( this.config.get('scrub_request_headers'), 'i' );
		this.resp_head_scrub_regex = new RegExp( this.config.get('scrub_response_headers'), 'i' );
		this.resp_code_success_match = new RegExp( this.config.get('resp_code_success_match') );
		
		this.method_match = new RegExp( this.config.get('method_match'), 'i' );
		this.host_match = new RegExp( this.config.get('host_match'), 'i' );
		this.uri_match = new RegExp( this.config.get('uri_match') );
		
		// setup custom headers
		this.custom_request_headers = Tools.mergeHashes(
			this.proxy.config.get('insert_request_headers') || {},
			this.config.get('insert_request_headers') || {}
		);
		this.custom_response_headers = Tools.mergeHashes(
			this.proxy.config.get('insert_response_headers') || {},
			this.config.get('insert_response_headers') || {}
		);
		
		// url prefix
		this.url_prefix = this.config.get('target_protocol') + '://' + this.config.get('target_hostname');
		if (this.config.get('target_port')) {
			if ((this.config.get('target_protocol') == 'http') && (this.config.get('target_port') != 80)) {
				this.url_prefix += ':' + this.config.get('target_port');
			}
			else if ((this.config.get('target_protocol') == 'https') && (this.config.get('target_port') != 443)) {
				this.url_prefix += ':' + this.config.get('target_port');
			}
		}
		
		// setup async queue
		this.queue = async.queue( this.dequeue.bind(this), this.stats.max_executing );
		
		// setup perf tracking system
		this.perf = new Perf();
		this.perf.totalKey = 'unused';
		this.perf._pool_minimums = {};
		this.perf._pool_maximums = {};
		this.lastMetrics = {};
	},
	
	handle_request: function(args, callback) {
		// check if request matches our criteria
		var request = args.request;
		
		if (request.headers['x-proxy'] && (request.headers['x-proxy'] != this.__name)) return false;
		if (!request.headers['x-proxy'] && this.config.get('x_proxy_only')) return false;
		if (!request.method.match(this.method_match)) return false;
		
		var req_host = request.headers['host'] || '';
		req_host = req_host.replace(/\:\d+$/, '');
		if (!req_host.match(this.host_match)) return false;
		
		if (!request.url.match(this.uri_match)) return false;
		
		this.logDebug(9, "Enqueuing request: " + request.method + " " + request.url, request.headers);
		
		// handle incoming http request to our pool
		if (this.stats.max_pending && (this.stats.num_pending >= this.stats.max_pending)) {
			// reject request, queue is full
			var err_msg = "Proxy queue is full: " + this.stats.num_pending + " requests pending";
			this.logError(429, err_msg, {
				uri: request.url,
				method: request.method,
				req_headers: request.headers
			});
			
			callback( 
				"429 Too Many Requests", 
				{ 'Content-Type': "text/html" }, 
				"ERROR: " + err_msg + "\n" 
			);
			return true; // request handled
		} // queue full
		
		// if client is requesting a blind request, send http response now
		if (args.request.headers['x-proxy-queue']) {
			// hide uploaded temp files from web server, so we can delete them ourselves later on.
			// this is mainly for handling blind requests, which returns a response to the client immediately.
			args._proxy_files = args.files;
			args.files = {};
			
			// generate unique ID for queue item (will be logged in transaction log)
			var request_id = Tools.generateUniqueID( 64, this.__name );
			
			// send JSON response back to client right away
			callback({
				code: 0,
				description: "Proxy request enqueued successfully.",
				request_id: request_id
			});
			callback = null;
			
			// keep only the essentials in memory from this point on
			var oargs = args;
			args = {
				request: {
					method: oargs.request.method,
					url: oargs.request.url,
					headers: oargs.request.headers,
					rawHeaders: oargs.request.rawHeaders,
					socket: {
						remoteAddress: oargs.request.socket.remoteAddress
					}
				},
				params: oargs.params,
				_proxy_files: oargs._proxy_files,
				_proxy_queue_id: request_id
			};
		} // blind
		
		// enqueue request
		this.stats.num_pending++;
		this.queue.push({
			args: args,
			callback: callback,
			retries: this.config.get('retries')
		});
		
		return true; // request handled
	},
	
	dequeue: function(task, callback) {
		// handle single task (proxy request)
		var self = this;
		
		// apply throttle, delay and requeue when exceeded
		var counters = this.perf.getCounters();
		if (counters.requests && this.stats.max_per_sec && (counters.requests >= this.stats.max_per_sec)) {
			if (!counters.throttle_alert) {
				// only log once per sec
				this.perf.count('throttle_alert', 1);
				this.logError('throttle', "Request rate has exceeded max limit: " + Math.floor(counters.requests + 1) + "/sec");
			}
			
			// requeue task after short delay
			setTimeout( function() { self.queue.push(task); }, this.config.get('throttle_requeue_delay_ms') );
			
			return callback();
		} // throttle
		
		// move task into executing
		this.stats.num_pending--;
		this.stats.num_executing++;
		
		// execute request
		var args = task.args;
		var request = args.request;
		var url = this.url_prefix + request.url;
		
		// process incoming raw headers into hash, preserve mixed case
		var raw_headers = {};
		for (var idx = 0, len = request.rawHeaders.length; idx < len; idx += 2) {
			var key = request.rawHeaders[idx];
			var value = request.rawHeaders[idx + 1];
			if (!key.match( this.req_head_scrub_regex )) {
				raw_headers[ key ] = request.headers[key.toLowerCase()] || value;
			}
		}
		
		// if front-end request was HTTPS, pass along a hint
		if (request.headers.ssl) raw_headers['X-Forwarded-Proto'] = 'https';
		
		// setup pixl-request options
		var opts = {
			method: request.method,
			agent: this.agent,
			headers: Tools.mergeHashes( raw_headers, this.custom_request_headers )
		};
		
		// optionally augment X-Forwarded-For, like a good proxy should
		if (this.config.get('append_to_x_forwarded_for')) {
			if (request.headers['x-forwarded-for']) opts.headers['X-Forwarded-For'] = request.headers['x-forwarded-for'] + ', ';
			else opts.headers['X-Forwarded-For'] = '';
			opts.headers['X-Forwarded-For'] += request.socket.remoteAddress;
			delete opts.headers['x-forwarded-for']; // just in case
		}
		
		// optionally handle http basic auth
		if (this.config.get('http_basic_auth')) {
			opts.auth = this.config.get('http_basic_auth');
		}
		
		// handle binary data / files or other
		var req_func = 'request';
		
		if (opts.method == 'POST') {
			// HTTP POST
			// preserve post parameters and/or file uploads
			req_func = 'post';
			if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'multipart/form-data';
			opts.headers['Content-Type'] = opts.headers['Content-Type'].replace(/\;.+$/, '');
			delete opts.headers['content-type']; // just in case
			
			switch (opts.headers['Content-Type']) {
				case 'multipart/form-data':
					var files = args._proxy_files || args.files;
					opts.data = Tools.copyHashRemoveKeys(args.params, files);
					
					opts.files = {};
					for (var key in files) {
						var file = files[key];
						opts.files[key] = [ file.path, file.name ];
					}
				break;
				
				case 'application/x-www-form-urlencoded':
					opts.data = args.params;
				break;
				
				default:
					if (args.params.raw) opts.data = args.params.raw;
				break;
			} // switch content-type
		}
		else {
			// HTTP GET or other
			if (args.params.raw) opts.data = args.params.raw;
		}
		
		this.logDebug(8, "Proxying " + request.method + " request: " + url, opts.headers);
		
		// prepare streaming response
		var callback_fired = false;
		
		if (opts.method != 'HEAD') {
			opts.download = new StreamMeter();
			opts.pre_download = function(err, resp, stream) {
				// fired after response headers but before data
				// see if retry is going to happen, and prepare for it
				if (!resp.statusCode.toString().match(self.resp_code_success_match) && (task.retries > 0)) {
					return false;
				}
				
				// if response is smaller than N bytes, switch to buffer mode (much faster)
				if (resp.headers['content-length'] && (parseInt(resp.headers['content-length']) < self.config.get('min_stream_size'))) {
					self.logDebug(10, "Aborting stream mode, size is " + resp.headers['content-length'] + " bytes");
					return false;
				}
				
				// prepare streaming response
				if (task.callback) {
					// start one end of stream
					resp.pipe( stream );
					
					// preserve raw response headers
					var raw_headers = {};
					for (var idx = 0, len = resp.rawHeaders.length; idx < len; idx += 2) {
						var key = resp.rawHeaders[idx];
						var value = resp.rawHeaders[idx + 1];
						if (!key.match( self.resp_head_scrub_regex )) {
							raw_headers[ key ] = resp.headers[key.toLowerCase()] || value;
						}
					}
					
					// fire callback with stream, which starts the other end
					callback_fired = true;
					task.callback(
						'' + resp.statusCode + ' ' + resp.statusMessage,
						Tools.mergeHashes( raw_headers, self.custom_response_headers ),
						stream
					);
					
					return true; // stream handled
				}
				else {
					// blind request, return false to fire original callback with buffer
					return false;
				}
			}; // pre_download
		} // not HEAD
		
		// actually send request now
		this.request[req_func]( url, opts, function(err, resp, data, perf) {
			// request complete
			self.stats.num_executing--;
			self.perf.count('requests', 1);
			
			// check for error
			if (!err && !resp.statusCode.toString().match( self.resp_code_success_match )) {
				err = new Error("HTTP " + resp.statusCode + " " + resp.statusMessage);
			}
			
			if (err) {
				self.perf.count('errors', 1);
				
				if (task.retries > 0) {
					// retry request, after delay
					var retry_delay_ms = self.config.get('error_retry_delay_base_ms');
					
					if (self.lastCounters && self.lastCounters.errors) {
						// backoff algo based on previous second's error count
						retry_delay_ms += (self.lastCounters.errors * self.config.get('error_retry_delay_mult_ms'));
					}
					if (self.config.get('error_retry_delay_max_ms')) {
						// don't allow backoff to go over max
						retry_delay_ms = Math.min( retry_delay_ms, self.config.get('error_retry_delay_max_ms') );
					}
					
					self.logDebug(3, err + " (" + task.retries + " retries remain)", {
						retry_delay_ms: retry_delay_ms
					});
					
					task.retries--;
					
					setTimeout( function() {
						self.stats.num_pending++;
						self.queue.push(task);
					}, retry_delay_ms );
					
					return callback();
				} // retries > 0
			} // error
			
			// if we had a hard error, mock up a HTTP response for it
			if (err && !resp) {
				resp = {
					statusCode: 500,
					statusMessage: "Internal Server Error",
					rawHeaders: [],
					headers: {}
				};
				data = err.toString();
			}
			
			// downstream proxy request completed
			var metrics = perf ? perf.metrics() : {};
			
			self.logDebug(8, "Proxy request completed: HTTP " + resp.statusCode + " " + resp.statusMessage, {
				resp_headers: resp.headers,
				perf_metrics: metrics
			});
			
			if (err && self.config.get('log_errors')) {
				self.logError( resp.statusCode, "Proxy Request Error: HTTP " + resp.statusCode + " " + resp.statusMessage, {
					url: url,
					method: request.method,
					req_headers: request.headers,
					http_code: resp.statusCode,
					http_message: resp.statusMessage,
					resp_headers: resp.headers,
					perf_metrics: metrics,
					error_details: data.toString(),
					request_id: args._proxy_queue_id || ''
				} );
			}
			
			// optionally log transaction
			var log_trans = self.config.get('log_transactions');
			if (!log_trans && perf && self.config.get('log_perf_ms') && (perf.elapsed('total') >= self.config.get('log_perf_ms'))) {
				log_trans = true;
			}
			
			if (log_trans) {
				self.logTransaction( 'http', "Proxy Request Completed: HTTP " + resp.statusCode + " " + resp.statusMessage, {
					url: url,
					method: request.method,
					req_headers: request.headers,
					http_code: resp.statusCode,
					http_message: resp.statusMessage,
					resp_headers: resp.headers,
					perf_metrics: metrics,
					request_id: args._proxy_queue_id || ''
				} );
			}
			
			// import perf metrics, if available
			if (perf) {
				self.perf.import( metrics );
				
				// track min/max as well
				var mins = self.perf._pool_minimums;
				var maxs = self.perf._pool_maximums;
				for (var key in metrics.perf) {
					var value = metrics.perf[key];
					if (!(key in mins) || (value < mins[key])) mins[key] = value;
					if (!(key in maxs) || (value > maxs[key])) maxs[key] = value;
				}
			} // perf
			
			// send response to client (if not in blind mode)
			if (task.callback) {
				if (!callback_fired) {
					// preserve raw response headers
					var raw_headers = {};
					for (var idx = 0, len = resp.rawHeaders.length; idx < len; idx += 2) {
						var key = resp.rawHeaders[idx];
						var value = resp.rawHeaders[idx + 1];
						if (!key.match( self.resp_head_scrub_regex )) {
							raw_headers[ key ] = resp.headers[key.toLowerCase()] || value;
						}
					}
					
					callback_fired = true;
					task.callback(
						'' + resp.statusCode + ' ' + resp.statusMessage,
						Tools.mergeHashes( raw_headers, self.custom_response_headers ),
						data
					);
				} // callback not fired
			}
			else {
				// blind mode, force temp files to be cleaned up
				args.files = args._proxy_files;
				delete args._proxy_files;
				self.web.deleteUploadTempFiles( args );
			}
			
			// mark queue task as complete
			callback();
			
		} ); // request
	},
	
	tick: function() {
		// called once per sec, log avg accumulated perf and reset
		var counters = this.lastCounters = this.perf.getCounters();
		
		this.perf.count('cur_pending_reqs', this.stats.num_pending || 0);
		this.perf.count('cur_executing_reqs', this.stats.num_executing || 0);
		
		this.perf.count('cur_client_conns', Tools.numKeys(this.web.conns) );
		this.perf.count('cur_server_conns', this.stats.num_sockets || 0);
		
		// omit unused total (only report accumulated http request totals)
		delete this.perf.perf.unused;
		
		// compute averages, decorate with our own additions
		var metrics = this.perf.metrics();
		metrics.minimums = {};
		metrics.maximums = {};
		metrics.averages = {};
		
		if (!counters.requests) counters.requests = 0;
		if (!counters.bytes_sent) counters.bytes_sent = 0;
		if (!counters.bytes_received) counters.bytes_received = 0;
		if (!metrics.perf.total) metrics.perf.total = 0;
		
		for (var key in metrics.perf) {
			metrics.minimums[key] = this.perf._pool_minimums[key] || 0;
			metrics.maximums[key] = this.perf._pool_maximums[key] || 0;
			metrics.averages[key] = Tools.shortFloat( metrics.perf[key] / (counters.requests || 1) );
		}
		
		delete metrics.perf;
		if (counters.requests) this.logDebug(2, "Average Performance Metrics", metrics);
		
		// save last second metrics for stats API
		this.lastMetrics = metrics;
		
		this.perf.reset();
		this.perf._pool_minimums = {};
		this.perf._pool_maximums = {};
	},
	
	shutdown: function(callback) {
		// gracefully stop pool, allow queue to empty naturally
		var self = this;
		
		this.logDebug(3, "Shutting down pool: " + this.__name, {
			current_pending_requests: this.stats.num_pending || 0,
			current_executing_requests: this.stats.num_executing || 0
		});
		
		async.whilst(
			function() {
				return( self.stats.num_pending || self.stats.num_executing ); 
			},
			function(callback) {
				setTimeout( callback, 100 );
			},
			function(err) {
				// all items flushed
				self.logDebug(3, "Pool shutdown complete");
				self.agent.destroy();
				callback();
			}
		);
	}
	
});
