// Unit tests for PixlProxy
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');

var Class = require("pixl-class");
var PixlServer = require('pixl-server');
var Tools = require('pixl-tools');

var PixlRequest = require('pixl-request');
var request = new PixlRequest();

process.chdir( __dirname );

var server = new PixlServer({
	
	__name: 'PixlProxyMock',
	__version: "1.0",
	
	config: {
		"log_dir": __dirname,
		"log_filename": "test.log",
		"debug_level": 9,
		"debug": 1,
		"echo": 0,
		
		"PixlProxy": {
			"pools": {
				"TestPool": {
					"method_match": "^(GET|HEAD|POST)$",
					"host_match": "^(127\\.0\\.0\\.1)$",
					
					"target_protocol": "http",
					"target_hostname": "127.0.0.1",
					"target_port": 3021,
					
					"use_keep_alives": true,
					"cache_dns_sec": 60,
					"max_concurrent_requests": 10,
					"max_requests_per_sec": 10,
					"use_queue": false,
					"follow_redirects": true,
					"http_timeout_ms": 1000,
					"append_to_x_forwarded_for": true,
					"retries": 0,
					"log_perf_ms": 1,
					"log_transactions": 1,
					"min_stream_size": 131072,
					"http_user_agent": "PixlProxy 1.0"
				}
			},
			
			"serve_static_files": false,
			"validate_ssl_certs": true,
			"insert_request_headers": {
				"Via": "PixlProxyTest 1.0"
			}
		},
		
		"WebServer": {
			"http_port": 3020,
			"http_htdocs_dir": __dirname,
			"http_max_upload_size": 104857600,
			"http_static_ttl": 3600,
			"http_static_index": "index.html",
			"http_server_signature": "PixlProxyTest 1.0",
			"http_gzip_text": 0,
			"http_timeout": 30,
			"http_regex_json": "DISABLED",
			"http_response_headers": {
				"Via": "PixlProxyTest 1.0"
			},
			
			"http_clean_headers": true,
			"http_log_requests": false,
			"http_regex_log": ".+",
			"http_recent_requests": 10,
			"http_max_connections": 255,
			
			"https": 0,
			"https_port": 3021,
			"https_cert_file": "conf/ssl.crt",
			"https_key_file": "conf/ssl.key",
			"https_force": 0,
			"https_timeout": 30,
			"https_header_detect": {
				"Front-End-Https": "^on$",
				"X-Url-Scheme": "^https$",
				"X-Forwarded-Protocol": "^https$",
				"X-Forwarded-Proto": "^https$",
				"X-Forwarded-Ssl": "^on$"
			}
		}
	},
	
	components: [
		require('pixl-server-web'),
		require('../lib/engine.js')
	]
	
});

// Unit Tests

module.exports = {
	setUp: function (callback) {
		var self = this;
		this.server = server;
		
		// delete old unit test log
		fs.unlink( "test.log", function(err) {
			// startup mock server
			server.startup( function() {
				// startup complete
				
				// write log in sync mode, for troubleshooting
				server.logger.set('sync', true);
				
				// save ref to proxy
				self.proxy = server.PixlProxy;
				
				// spawn simple web server for proxy target
				self.webserver = cp.spawn( "node", ["webserver.js", "--debug"] );
				
				// wait until webserver child process is ready
				var ws_output = '';
				var ws_ready = false;
				
				self.webserver.stdout.on('data', function(data) {
					ws_output += data.toString();
					if (!ws_ready && ws_output.match(/_WEBSERVER_IS_READY_/)) {
						ws_ready = true;
						callback();
					}
				});
				
				self.webserver.stderr.on('data', function(data) {
					console.log("WEBSERVER ERROR: " + data);
				});
				
			} ); // startup
		} ); // delete
	},
	
	tests: [
		
		function testSimpleRequest(test) {
			// test simple HTTP GET proxy request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back, check for XFF appendage
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( !!json.headers['x-forwarded-for'], "Found XFF in header echo" );
					test.ok( json.headers['x-forwarded-for'].match(/127\.0\.0\.1|localhost/i), "Found correct IP in XFF: " + json.headers['x-forwarded-for'] );
					
					test.done();
				} 
			);
		},
		
		// HTTP HEAD (Standard)
		function testStandardHead(test) {
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.head( 'http://127.0.0.1:3020/index.html',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !!resp.headers['content-length'], "Found content-length header");
					test.ok(
						parseInt(resp.headers['content-length']) == fs.readFileSync("index.html").length, 
						"Correct content-length header: " + resp.headers['content-length']
					);
					test.ok( data.length == 0, "Data length is zero" );
					test.done();
				}
			);
		},
		
		// HTTP POST (Standard)
		function testStandardPost(test) {
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.post( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Proxy': "TestPool"
					},
					data: {
						myparam: "foobar4567"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					test.done();
				} 
			);
		},
		
		// HTTP POST + File Upload
		function testMultipartPost(test) {
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.post( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Proxy': "TestPool"
					},
					multipart: true,
					data: {
						myparam: "foobar5678"
					},
					files: {
						file1: "spacer.gif"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					// test.debug( "JSON Response: ", json );
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar5678", "Correct param in JSON response: " + json.params.myparam );
					test.ok( !!json.files, "Found files object in JSON response" );
					test.ok( !!json.files.file1, "Found file1 object in JSON response" );
					test.ok( json.files.file1.size == 43, "Uploaded file has correct size (43): " + json.files.file1.size );
					test.done();
				} 
			);
		},
		
		// JSON POST
		function testJSONPOST(test) {
			// test JSON HTTP POST proxy request to webserver backend
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.json( 'http://127.0.0.1:3020/json', { foo: 'barpost' },
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.foo == "barpost", "Correct param in JSON response: " + json.params.foo );
					
					test.done();
				} 
			);
		},
		
		// XML POST
		function testXMLPOST(test) {
			// test XML HTTP POST proxy request to webserver backend
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.xml( 'http://127.0.0.1:3020/xml', { foo: 'barpost' },
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, xml, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					test.ok( !!xml, "Got XML in response" );
					test.ok( xml.code == 0, "Correct code in XML response: " + xml.code );
					
					test.ok( !!xml.params, "Found params object in XML response" );
					test.ok( xml.params.foo == "barpost", "Correct param in XML response: " + xml.params.foo );
					
					test.done();
				} 
			);
		},
		
		// Error (404)
		function testFileNotFound(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/noexist',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 404, "Got 404 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.done();
				} 
			);
		},
		
		// Error (Front-end Timeout)
		function testFrontEndTimeout(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/sleep?ms=750',
				{
					headers: {
						'X-Proxy': "TestPool"
					},
					timeout: 500
				},
				function(err, resp, data, perf) {
					test.ok( !!err, "Got error from PixlRequest" );
					test.ok( err.toString().match(/timeout|timed out/i), "Correct error message: " + err );
					test.done();
				} 
			);
		},
		
		// Error (Back-end Timeout)
		function testBackEndTimeout(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/sleep?ms=1500',
				{
					headers: {
						'X-Proxy': "TestPool"
					},
					timeout: 1500
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 500, "Got 500 response: " + resp.statusCode );
					test.ok( data.toString().match(/timeout|timed out/i), "Correct error message: " + err );
					test.done();
				} 
			);
		},
		
		// Unsupported Method (PUT)
		function testUnsupportedMethod(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.request( 'http://127.0.0.1:3020/json',
				{
					method: 'PUT',
					headers: {
						'X-Proxy': "TestPool"
					},
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode >= 400, "Got expected bad response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		// Missing X-Proxy, incorrect hostname
		function testMissingXProxy(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://localhost:3020/json',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 400, "Got 400 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		// Incorrect X-Proxy
		function testIncorrectXProxy(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.request( 'http://127.0.0.1:3020/json',
				{
					method: 'GET',
					headers: {
						'X-Proxy': "TestPooooooooooool"
					},
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 400, "Got 400 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		// append_to_x_forwarded_for false
		function testXFFDisabled(test) {
			// hot modify config
			this.proxy.pools.TestPool.config.set('append_to_x_forwarded_for', false);
			this.proxy.pools.TestPool.perf.reset();
			
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back, should not have XFF this time
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( !json.headers['x-forwarded-for'], "No XFF in header echo" );
					
					test.done();
				} 
			);
		},
		
		// follow_redirects
		function testRedirectFollow(test) {
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.json( 'http://127.0.0.1:3020/redirect', false,
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "PixlProxyTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-joetest'] == "Z1234", "Correct X-JoeTest header: " + resp.headers['x-joetest'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					
					test.ok( !!json.query, "Found query echo in response" );
					test.ok( json.query.redirected == 1, "Found redirected query param" );
					
					test.done();
				} 
			);
		},
		
		function testRedirectNoFollow(test) {
			// disable follow redirects
			this.proxy.pools.TestPool.request.setFollow( false );
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/redirect',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 302, "Got 302 response: " + resp.statusCode );
					test.ok( !!resp.headers['location'], "Got location header" );
					
					test.done();
				} 
			);
		},
		
		function testPassthruCompressionEnabled(test) {
			// test backend gzip passthrough compression
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Proxy': "TestPool",
						'Accept-Encoding': "gzip"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !!resp.headers['content-encoding'], "Found content-encoding header");
					test.ok( resp.headers['content-encoding'] == "gzip", "Correct content-encoding header");
					test.done();
				}
			);
		},
		
		function testPassthruCompressionDisabled(test) {
			// test backend gzip passthrough compression force disabled
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Proxy': "TestPool",
						'Accept-Encoding': "none"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !resp.headers['content-encoding'], "No content-encoding header");
					test.done();
				}
			);
		},
		
		function testBackEndStream(test) {
			// test backend stream response (should be no content-length, and chunked)
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/stream',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !resp.headers['content-length'], "No content-length header" );
					test.ok( !!resp.headers['transfer-encoding'], "Got transfer-encoding header" );
					test.ok( resp.headers['transfer-encoding'] == "chunked", "Correct transfer-encoding header" );
					test.ok( data.length == fs.readFileSync("spacer.gif").length, "Correct binary response data length" );
					test.done();
				}
			);
		},
		
		function testLargeBuffer(test) {
			// test backend buffer (large)
			// over 128K so this will be streamed
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/large',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !!resp.headers['content-length'], "Got content-length header" );
					test.ok( resp.headers['content-length'] == 1024 * 1024, "Correct content-length header value" );
					test.ok( data.length == 1024 * 1024, "Correct binary response data length" );
					test.done();
				}
			);
		},
		
		function testZeroByteContent(test) {
			// test zero byte content
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/zero',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !resp.headers['content-length'], "No content-length header" );
					test.ok( data.length == 0, "Data length is zero" );
					test.done();
				}
			);
		},
		
		function testZeroByteContentWithLength(test) {
			// test zero byte content with content-length
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			request.get( 'http://127.0.0.1:3020/zero?cl=1',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( ('content-length' in resp.headers), "Found content-length header" );
					test.ok( resp.headers['content-length'] == 0, "Correct content-length header" );
					test.ok( data.length == 0, "Data length is zero" );
					test.done();
				}
			);
		},
		
		// max_requests_per_sec
		function testMaxRequestsPerSec(test) {
			var self = this;
			var detected_tmr = false; // HTTP 429 Too Many Requests
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			async.timesSeries( 30,
				function(idx, callback) {
					request.get( 'http://127.0.0.1:3020/index.html',
						{
							headers: {
								'X-Proxy': "TestPool"
							}
						},
						function(err, resp, data, perf) {
							if (resp.statusCode == 429) detected_tmr = true;
							callback();
						}
					);
				},
				function(err) {
					test.ok( detected_tmr, "Got 'HTTP 429 Too Many Requests' after flooding" );
					test.done();
				}
			);
		}, 
		
		// max_concurrent_requests
		function testMaxQueueLength(test) {
			var self = this;
			var detected_tmr = false; // HTTP 429 Too Many Requests
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			async.times( 30,
				function(idx, callback) {
					request.get( 'http://127.0.0.1:3020/sleep?ms=100',
						{
							headers: {
								'X-Proxy': "TestPool"
							}
						},
						function(err, resp, data, perf) {
							if (resp.statusCode == 429) {
								detected_tmr = true;
								// callback( new Error("ABORT") );
								callback();
							}
							else callback();
						}
					);
				},
				function(err) {
					test.ok( detected_tmr, "Got 'HTTP 429 Too Many Requests' after flooding" );
					test.done();
				}
			);
		},
		
		/*function testDelay(test) {
			setTimeout( function() { test.done(); }, 1000 );
		},*/
		
		// retries
		function testRetries(test) {
			// hot modify config
			var self = this;
			
			self.proxy.pools.TestPool.config.set('retries', 5);
			
			// reset perf
			self.proxy.pools.TestPool.perf.reset();
			
			var time_start = Tools.timeNow();
			
			request.get( 'http://127.0.0.1:3020/sleep?ms=100&error=1',
				{
					headers: {
						'X-Proxy': "TestPool"
					},
					timeout: 1500
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 500, "Got 500 response: " + resp.statusCode );
					test.ok( !!resp.headers['x-sleep'], "Found X-Sleep header" );
					
					var elapsed = Tools.timeNow() - time_start;
					test.ok( elapsed >= 0.5, "At least 500ms has elapsed in retry test: " + elapsed );
					
					test.done();
				} 
			);
		
		}, // testRetries
		
		function testBadHeader(test) {
			// test header with bad characters in it
			
			// reset perf
			this.proxy.pools.TestPool.perf.reset();
			
			// must hot modify config for this
			this.proxy.pools.TestPool.custom_request_headers['X-BadHeader'] = "Hello 😂 There!";
			
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Proxy': "TestPool"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 500, "Got 500 response: " + resp.statusCode );
					test.done();
				} 
			);
		} // testBadHeader
		
	], // tests
	
	tearDown: function (callback) {
		// clean up
		var self = this;
		
		this.server.shutdown( function() {
			
			// shut down webserver process
			self.webserver.on('exit', function(code, signal) {
				callback();
			});
			self.webserver.kill();
			
		} );
	}
	
};
