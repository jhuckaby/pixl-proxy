// Simple test web server used by PixlProxy unit test suite.

var fs = require('fs');
var PixlServer = require('pixl-server');
var Tools = require('pixl-tools');
var XML = require('pixl-xml');

process.chdir( __dirname );

var server = new PixlServer({
	
	__name: 'TestWebServer',
	__version: "1.0",
	
	// configFile: 'nswt-config.json'
	config: {
		"log_dir": __dirname,
		"log_filename": "test.log",
		"debug_level": 9,
		// "uid": "www",
		
		"WebServer": {
			"http_port": 3021,
			"http_htdocs_dir": __dirname,
			"http_max_upload_size": 33554432,
			"http_static_ttl": 3600,
			"http_server_signature": "TestWebServer 1.0",
			"http_gzip_text": 1,
			"http_response_headers": { 'X-JoeTest': "Z1234" },
			"http_keep_alives": 1,
			"http_log_requests": 1,
			"http_max_connections": 255
		}
	},
	
	components: [
		require('pixl-server-web')
	]
	
});

server.startup( function() {
	server.logDebug(9, "Startup complete");
	
	server.logger.set('sync', true);
	
	var web_server = server.WebServer;
	
	web_server.addURIHandler( '/json', 'JSON Test', function(args, callback) {
		// send custom JSON response
		callback( {
			code: 0,
			description: "Success",
			user: { Name: "Joe", Email: "foo@bar.com" },
			params: args.params,
			query: args.query,
			files: args.files,
			headers: args.request.headers
		} );
	} );
	
	web_server.addURIHandler( '/xml', 'XML Test', function(args, callback) {
		// parse XML request
		var xml = null;
		try { xml = XML.parse( args.params.raw ); }
		catch (err) {
			return callback( "500 Internal Server Error", {}, null );
		}
		
		// send custom XML response
		var doc = {
			code: 0,
			params: xml
		};
		callback( "200 OK", {}, XML.stringify( doc, 'Response' ) );
	} );
	
	web_server.addURIHandler( '/sleep', 'Sleep Test', function(args, callback) {
		// send custom JSON response
		var ms = parseInt( args.query.ms );
		
		setTimeout( function() {
			if (args.query.error) {
				callback( 
					"500 Internal Server Error", 
					{ 'X-Sleep': 1 },
					null
				);
			}
			else {
				callback( {
					code: 0,
					description: "Slept for " + ms + "ms",
					ms: ms
				} );
			}
		}, ms );
	} );
	
	web_server.addURIHandler( '/redirect', 'Redirect Test', function(args, callback) {
		// send custom redirect response
		callback( 
			"302 Found", 
			{ 'Location': web_server.getSelfURL(args.request, "/json?redirected=1") },
			null
		);
	} );
	
	web_server.addURIHandler( '/stream', 'Stream Test', function(args, callback) {
		// send custom file stream response
		callback( "200 OK", { 'Content-Type': "application/octet-stream" }, fs.createReadStream("spacer.gif") );
	} );
	
	var large_buf = Buffer.alloc( 1024 * 1024, "Test Buffer - " );
	
	web_server.addURIHandler( '/large', 'Large Buffer Test', function(args, callback) {
		// send large buffer response
		callback( "200 OK", { 'Content-Type': "application/octet-stream" }, large_buf );
	} );
	
	web_server.addURIHandler( '/zero', 'Zero Test', function(args, callback) {
		// send zero byte response
		callback( "200 OK", args.query.cl ? {'Content-Length': "0"} : {}, null );
	} );
	
	// emit special string that unit test parent process is looking for on stdout
	console.log( "_WEBSERVER_IS_READY_" );
	
} );

