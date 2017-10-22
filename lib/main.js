#!/usr/bin/env node

// PixlProxy - Main entry point
// Copyright (c) 2016 Joseph Huckaby
// Released under the MIT License

var PixlServer = require("pixl-server");

// chdir to the proper server root dir
process.chdir( require('path').dirname( __dirname ) );

var server = new PixlServer({
	
	__name: 'PixlProxy',
	__version: require('../package.json').version,
	
	configFile: "conf/config.json",
	
	components: [
		require('pixl-server-web'),
		require('./engine.js')
	]
	
});

server.startup( function() {
	// server startup complete
	process.title = server.__name + ' Server';	
} );
