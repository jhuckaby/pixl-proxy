// Install Script for PixlProxy 1.0

var fs = require('fs');

// chdir to the proper server root dir
process.chdir( require('path').dirname( __dirname ) );

// Set permissions on bin scripts
fs.chmodSync( "bin/proxyctl.sh", "755" );

// Copy sample config if custom one doesn't exist
fs.stat( "conf/config.json", function(err, stats) {
	if (err) {
		// file doesn't exist yet, copy over sample
		var inp = fs.createReadStream( "conf/sample-config.json" );
		var outp = fs.createWriteStream( "conf/config.json", { mode: "644" });
		inp.pipe( outp );
	}
} );
