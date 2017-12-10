// PixlProxy Server Component
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

var assert = require('assert');
var fs = require('fs');
var cp = require('child_process');
var Path = require('path');
var async = require('async');

var Config = require("pixl-config");
var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var Request = require("pixl-request");
var Pool = require("./pool.js");

module.exports = Class.create({
	
	__name: 'PixlProxy',
	__parent: Component,
	
	web: null,
	pools: null,
	
	startup: function(callback) {
		// start app api service
		var self = this;
		this.logDebug(3, "PixlProxy engine starting up", process.argv );
		
		// we'll need these components frequently
		this.web = this.server.WebServer;
		
		// create pool objects
		this.pools = {};
		var pool_configs = this.config.get('pools');
		
		for (var key in pool_configs) {
			var pool_config = pool_configs[key];
			this.logDebug(4, "Setting up pool: " + key, pool_config);
			
			var pool = new Pool();
			pool.init( this.server, new Config(pool_config, false, true) );
			pool.__name = key; // for logging
			pool.proxy = this;
			pool.web = this.web;
			
			this.pools[key] = pool;
			pool.startup();
		}
		
		// optionally handle special internal stats URI
		if (this.config.get('stats_uri_match')) {
			this.web.addURIHandler( 
				new RegExp(this.config.get('stats_uri_match')), 
				'PixlProxy Stats', 
				true, // ACL lock for this API
				this.handle_stats.bind(this) 
			);
		}
		
		// catch all requests for proxy
		this.web.addURIHandler( /.+/, 'PixlProxy', this.handle_request.bind(this) );
		
		// listen for ticks so we can log stats
		this.server.on('tick', this.tick.bind(this));
		
		// optionally bypass ssl cert validation (for trusted networks only)
		if (!this.config.get('validate_ssl_certs')) {
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
		}
		
		// optionally renice ourselves
		if (this.config.get('nice')) {
			var cmd = this.config.get('nice_cmd') || 'renice';
			var nice = this.config.get('nice');
			if ((typeof(nice) == 'number') && (nice > 0)) nice = '+' + nice;
			cmd += ' ' + nice + ' -p ' + process.pid;
			this.logDebug(3, "Executing nice command: " + cmd);
			
			cp.exec( cmd, { timeout: 5000 }, function(err, stdout, stderr) {
				if (err) {
					self.logDebug(1, "Nice error: " + err);
				}
				else {
					var output = '' + stdout + stderr;
					if (output.match(/S/)) self.logDebug(1, "Nice error: " + output);
				}
				
				// startup complete
				callback();
			} );
		}
		else {
			// startup complete
			callback();
		}
	},
	
	handle_request: function(args, callback) {
		// handle incoming http request
		var self = this;
		var request = args.request;
		
		// disallow new requests during shutdown
		if (this.server.shut) {
			return callback( 
				"500 Internal Server Error", 
				{ 'Content-Type': "text/html" }, 
				"ERROR: Proxy is shutting down.\n" 
			);
		}
		
		// figure out which pool request belongs to
		var handled = false;
		
		// check explicit x-proxy header first, honor that above all else
		if (request.headers['x-proxy'] && this.pools[request.headers['x-proxy']]) {
			if (this.pools[request.headers['x-proxy']].handle_request( args, callback )) {
				handled = true;
			}
		}
		
		// no match?  fallback to checking all pools (method, host, uri)
		if (!handled) {
			for (var key in this.pools) {
				if (key != 'default') {
					if (this.pools[key].handle_request( args, callback )) {
						handled = true;
						break;
					}
				}
			}
		}
		
		// fallback to default pool, if applicable
		if (!handled && this.pools.default) {
			request.headers['x-proxy'] = 'default';
			this.pools.default.handle_request( args, callback );
			handled = true;
		}
		
		if (!handled) {
			if (this.config.get('serve_static_files')) {
				// fallback to serving static file
				return callback( false );
			}
			else {
				var err_msg = "Proxy Pool not found for request: " + request.method + " " + request.url;
				self.logError(400, err_msg);
				
				return callback( 
					"400 Bad Request", 
					{ 'Content-Type': "text/html" }, 
					"ERROR: " + err_msg + "\n" 
				);
			} // error
		} // not handled
	},
	
	handle_stats: function(args, callback) {
		// send back stats for all pools (last full second)
		var stats = { pools: {} };
		
		for (var key in this.pools) {
			stats.pools[key] = this.pools[key].lastMetrics;
		}
		
		// also include stats from web server
		stats.web = this.web.getStats();
		stats.web.stats.cur_sockets = Tools.numKeys( stats.web.sockets || {} );
		
		// send to client in JSON format
		callback( stats );
	},
	
	tick: function() {
		// called every second, pass down to pools
		for (var key in this.pools) {
			this.pools[key].tick();
		}
	},
	
	shutdown: function(callback) {
		// shutdown api service
		var self = this;
		
		this.logDebug(2, "Shutting down PixlProxy");
		
		// shut down all pools
		async.each( Object.keys(this.pools),
			function(key, callback) {
				self.pools[key].shutdown( callback );
			},
			function(err) {
				callback();
			}
		); // async.each
	}
	
});
