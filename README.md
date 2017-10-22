# Overview

**PixlProxy** is a standalone HTTP proxy daemon written in Node.js, which can forward incoming requests to any number of destination hosts.  It can serve as a front-end to your applications, providing throttling, max concurrent request limit, HTTPS, Keep-Alives, as well as a proxy for back-end service requests.  It also has an in-memory queue system, for supporting asynchronous blind requests.

## Features

- Multiple proxy configurations, triggered by hostname, URI or header match
- Separate connection pool configurations on the client and server side
- Maximum concurrent requests and maximum request rate settings
- Supports HTTP and HTTPS on the front and/or back ends
- Supports Keep-Alives on the front and/or back ends
- Supports all standard HTTP methods, including HEAD, GET, POST and PUT
- Extremely fast and stable (see [Benchmarks](#benchmarks) below)
- Small memory footprint, even for large HTTP requests / responses
- Passthrough or active content encoding (GZip, Deflate, etc.)
- In-memory queue system for blind proxy requests
- Optional transaction logging
- Optional performance threshold logging
- JSON Stats REST API

## Table of Contents

- [Overview](#overview)
	* [Features](#features)
- [Usage](#usage)
	* [Installation](#installation)
	* [Configuration](#configuration)
		+ [Global Configuration](#global-configuration)
		+ [WebServer Configuration](#webserver-configuration)
		+ [PixlProxy Configuration](#pixlproxy-configuration)
			- [serve_static_files](#serve_static_files)
			- [stats_uri_match](#stats_uri_match)
			- [validate_ssl_certs](#validate_ssl_certs)
		+ [Pool Configuration](#pool-configuration)
			- [method_match](#method_match)
			- [host_match](#host_match)
			- [uri_match](#uri_match)
			- [x_proxy_only](#x_proxy_only)
			- [target_protocol](#target_protocol)
			- [target_hostname](#target_hostname)
			- [target_port](#target_port)
			- [use_keep_alives](#use_keep_alives)
			- [cache_dns_sec](#cache_dns_sec)
			- [max_concurrent_requests](#max_concurrent_requests)
			- [max_requests_per_sec](#max_requests_per_sec)
			- [max_queue_length](#max_queue_length)
			- [follow_redirects](#follow_redirects)
			- [http_user_agent](#http_user_agent)
			- [http_timeout_ms](#http_timeout_ms)
			- [http_basic_auth](#http_basic_auth)
			- [append_to_x_forwarded_for](#append_to_x_forwarded_for)
			- [resp_code_success_match](#resp_code_success_match)
			- [retries](#retries)
			- [log_perf_ms](#log_perf_ms)
			- [log_transactions](#log_transactions)
			- [log_errors](#log_errors)
			- [insert_request_headers](#insert_request_headers)
			- [insert_response_headers](#insert_response_headers)
		+ [Advanced Properties](#advanced-properties)
			- [scrub_request_headers](#scrub_request_headers)
			- [scrub_response_headers](#scrub_response_headers)
			- [min_stream_size](#min_stream_size)
			- [throttle_requeue_delay_ms](#throttle_requeue_delay_ms)
	* [Command-Line Usage](#command-line-usage)
		+ [Debugging](#debugging)
		+ [Server Reboot](#server-reboot)
		+ [Upgrading](#upgrading)
	* [Request Routing](#request-routing)
		+ [Single Pool](#single-pool)
		+ [Request Matching](#request-matching)
		+ [X-Proxy Header](#x-proxy-header)
		+ [Default Pool](#default-pool)
	* [Throttling](#throttling)
		+ [Max Client Connections](#max-client-connections)
	* [Queue System](#queue-system)
	* [JSON Stats API](#json-stats-api)
		+ [Web Server Stats](#web-server-stats)
	* [Keep-Alives](#keep-alives)
	* [HTTPS](#https)
	* [Content-Encoding](#content-encoding)
- [Logging](#logging)
	* [Debug Log](#debug-log)
	* [Error Log](#error-log)
	* [Transaction Log](#transaction-log)
- [Benchmarks](#benchmarks)
- [License](#license)

# Usage

## Installation

Use [npm](https://www.npmjs.com/) to install the module.  Note that this is designed to run as a standalone background daemon, not as a library for use in another app, so take care to understand where `npm` installs the software.  Typical installations are global using the `-g` switch:

```
sudo npm install -g pixl-proxy
```

To see where `npm` installs global packages, you can type `npm root -g`.  Once installed globally, you should have a `proxyctl` command in your PATH.  Use this to start, stop and otherwise control the daemon.  See [Command-Line Usage](#command-line-usage) below.

## Configuration

The configuration for PixlProxy is stored in a single JSON file on disk.  It is located in the module's `conf` directory, and named `config.json`.  Upon initial installation, a sample config is created for you.  To edit the file using your favorite terminal editor (i.e. the `EDITOR` environment variable) type this:

```
sudo proxyctl config
```

If you just want to reveal the full filesystem path of the config file, you can type:

```
proxyctl showconfig
```

Here is a sample configuration file:

```js
{
	"log_dir": "logs",
	"log_filename": "proxy-events.log",
	"pid_file": "logs/pid.txt",
	"debug_level": 9,
	
	"WebServer": {
		"http_port": 3020,
		"http_htdocs_dir": "htdocs",
		"http_server_signature": "PixlProxy 1.0",
		"http_gzip_text": false,
		"http_timeout": 30,
		"http_keep_alives": "default",
		"http_regex_json": "DISABLED",
		"http_log_requests": false,
		"http_regex_log": ".+",
		"http_recent_requests": 0,
		"http_max_connections": 255,
		"https": false,
		"http_response_headers": {
			"Via": "PixlProxy 1.0"
		}
	},
	
	"PixlProxy": {
		"serve_static_files": false,
		"stats_uri_match": "^/proxy-stats",
		"validate_ssl_certs": true,
		
		"pools": {
			
			"MyPool1": {
				"method_match": "^(GET|HEAD|POST)$",
				"host_match": "^(127\\.0\\.0\\.1|localhost)$",
				"uri_match": "^/proxy",
				
				"target_protocol": "http",
				"target_hostname": "test.myserver.com",
				"target_port": 80,
				
				"use_keep_alives": true,
				"cache_dns_sec": 60,
				"max_concurrent_requests": 10,
				"max_requests_per_sec": 1000,
				"max_queue_length": 100,
				"follow_redirects": true,
				"http_timeout_ms": 30000,
				"append_to_x_forwarded_for": true,
				"retries": 5,
				"log_perf_ms": 100,
				"log_transactions": false,
				
				"http_user_agent": "PixlProxy 1.0",
				"insert_request_headers": {
					"Via": "PixlProxy 1.0"
				}
			}
		}
	}
}
```

The configuration is split up into three primary sections: top-level global properties, the front-end web server configuration (`WebServer`), and the back-end proxy configurations (`PixlProxy`).

### Global Configuration

The top-level properties are all used by the [pixl-server](https://github.com/jhuckaby/pixl-server) daemon framework.  Please see the [pixl-server configuration](https://github.com/jhuckaby/pixl-server#configuration) docs for a list of all the available properties.  Here are brief descriptions of the ones from the sample configuration above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `log_dir` | String | Directory path where event log will be stored.  Can be a fully-qualified path, or relative from the PixlProxy base directory. |
| `log_filename` | String | Event log filename, joined with `log_dir`.  See [Logging](#logging) below. |
| `pid_file` | String | Partial path to the PID file, used by the daemon (relative from the PixlProxy base directory). |
| `debug_level` | Integer | Debug logging level, larger numbers are more verbose, 1 is quietest, 10 is loudest. |

### WebServer Configuration

The properties in the `WebServer` object are all used by the [pixl-server-web](https://github.com/jhuckaby/pixl-server-web) component.  The web server is basically the "front-end" of the proxy, and it routes requests to the back-end.  Please see the [pixl-server-web configuration](https://github.com/jhuckaby/pixl-server-web#configuration) docs for a full description of all the properties, but here are a few that pertain specifically to PixlProxy:

| Property Name | Type | Description |
|---------------|------|-------------|
| `http_port` | Integer | This is the port to listen on. The standard web port is 80, but note that only the root user can listen on ports below 1024. |
| `http_htdocs_dir` | String | This directory is used to serve static files, when [serve_static_files](#serve_static_files) mode is enabled and no proxy configuration matches a request. |
| `http_server_signature` | String | This is the default `Server` header to send back to clients, when one is not included in the proxy response. |
| `http_gzip_text` | Boolean | Set this to `true` to compress text-based responses that aren't already compressed.  See [Content-Encoding](#content-encoding) for details. |
| `http_timeout` | Integer | This is the front-end HTTP idle timeout value in seconds.  This doubles as the Keep-Alive socket timeout as well. |
| `http_keep_alives` | String | This specifies the Keep-Alive mode in the web server.  Recommend you set this to the string `"default"`.  See the [pixl-server-web docs](https://github.com/jhuckaby/pixl-server-web#http_keep_alives) for details. |
| `http_regex_json` | String | This should always be set to the string `"DISABLED"`, as this web server feature is not used in PixlProxy. |
| `http_log_requests` | Boolean | Set this to `true` if you want client HTTP requests to be logged as transactions.  See [Logging](#logging) for details. |
| `http_regex_log` | String | Use this feature to only log *some* requests, based on a URI regular expression match.  See [Logging](#logging) for details. |
| `http_recent_requests` | Integer | This is the number of recent requests to track in the stats.  See [JSON Stats API](#json-stats-api) below for details. |
| `http_max_connections` | Integer | This is the global maximum limit of simultaneous front-end client TCP connections.  Once this limit is reached, new sockets are rejected (hard-closed), and a `maxconns` error is logged. |
| `https` | Boolean | Set this to `true` if you want to serve HTTPS to the client (see [HTTPS](#https) below for details). |
| `http_response_headers` | Object | Use this to inject any custom HTTP response headers into all client responses for all pools. |

### PixlProxy Configuration

The `PixlProxy` object contains the configuration for the back-end of the proxy.  That is, where the incoming front-end web server requests are routed.  And you can have *multiple* back-end configurations, targeted by various criteria, including request method, hostname and URI.

Each back-end proxy configuration is called a "pool" (because it typically pools connections via Keep-Alives), and you can have as many as you want.  See [Pool Configuration](#pool-configuration) below for more details, but first, here are a few properties that go just inside the `PixlProxy` object, but aren't associated with any particular pool:

#### serve_static_files

If you would like the front-end web server to serve static files as well as proxy requests to a back-end, set the `serve_static_files` property to `true`.  Basically, any incoming request that *doesn't* match a proxy pool configuration will be looked up as a static file on disk, using the web server's `http_htdocs_dir` path as the base directory.

If you choose to run PixlProxy as a front-end web server for static files, please check out the [pixl-server-web documentation](https://github.com/jhuckaby/pixl-server-web), as there are some other properties you will probably want to set in the `WebServer` object, including [http_static_ttl](https://github.com/jhuckaby/pixl-server-web#http_static_ttl) and [http_static_index](https://github.com/jhuckaby/pixl-server-web#http_static_index), among others.

The default is `false` (disabled).

#### stats_uri_match

If you would like to enable the [JSON Stats API](#json-stats-api), this property allows you to configure which URI activates the service.  It is formatted as a regular expression wrapped in a string, e.g. `^/proxy-stats`, and is matched case-sensitively.  To disable the stats API, set this to Boolean `false` (or just omit it from your configuration, as it defaults to disabled).

For more details, see the [JSON Stats API](#json-stats-api) section below.

#### validate_ssl_certs

Normally you shouldn't have to bother with this, but if you are trying to proxy to a downstream host via HTTPS and getting certificate errors, you may have to bypass Node's SSL certification validation.  To do this, set the `validate_ssl_certs` property to `false`.

Make sure you understand the security ramifications, and completely trust the host you are connecting to, and the network you are on. Skipping the certificate validation step should really only be done in special circumstances, such as testing your own internal server with a self-signed cert.

### Pool Configuration

Inside the `PixlProxy` object, you can define one or more "pools" (back-end proxy targets).  These should all go into a `pools` object, and can be named however you like.  The names are used for logging, and can also be used to target the proxy by custom header (but you can also target by other means).  Example config layout:

```js
"PixlProxy": {
	"pools": {
		"MyPool1": {
			...
		},
		"MyPool2": {
			...
		}
	}
}
```

Inside each of your pool objects you can define matching criteria (which HTTP requests to route), targeting information (which destination service to point to), and many other optional properties.  Here is the full list:

#### method_match

The `method_match` property allows you to match incoming requests based on the HTTP request method (e.g. GET, POST, etc.).  This is interpreted as a regular expression wrapped in a string matched case-insensitively, so if you wanted to match only GET and POST, you could set this to:

```js
"MyPool1": {
	"method_match": "^(GET|POST)$"
}
```

By default all request methods are matched (e.g. `".+"`).

This is one of three criteria matching properties (along with `host_match` and `uri_match`) which allow you to route requests to your pool automatically.  See the [Request Routing](#request-routing) section below for details.

#### host_match

The `host_match` property allows you to match incoming requests based on the URL hostname (i.e. `Host` header).  This is interpreted as a regular expression wrapped in a string matched case-insensitively.  Example:

```js
"MyPool1": {
	"host_match": "^(mydomain1\\.com|mydomain2\\.com)$"
}
```

By default all hosts are matched (e.g. `".*"` which includes a blank host as well).

This is one of three criteria matching properties (along with `method_match` and `uri_match`) which allow you to route requests to your pool automatically.  See the [Request Routing](#request-routing) section below for details.

#### uri_match

The `uri_match` property allows you to match incoming requests based on the URI itself.  This is interpreted as a regular expression wrapped in a string matched case-sensitively.  Example:

```js
"MyPool1": {
	"uri_match": "^/proxy"
}
```

By default all URIs are matched (e.g. `".+"`).

This is one of three criteria matching properties (along with `method_match` and `host_match`) which allow you to route requests to your pool automatically.  See the [Request Routing](#request-routing) section below for details.

#### x_proxy_only

The `x_proxy_only` property, when set to `true`, specifies that the pool should only receive requests if they have a `X-Proxy` header, and it matches the Pool ID exactly.  Example:

```js
"MyPool1": {
	"x_proxy_only": true
}
```

See [Request Routing](#request-routing) below for details.

#### target_protocol

The `target_protocol` property specifies which protocol to use when connecting to the destination service.  It should be set to either `http` or `https`.  It defaults to `http`.

```js
"MyPool1": {
	"target_protocol": "http"
}
```

#### target_hostname

The `target_hostname` property specifies which hostname to connect to for the destination service.  This is a required property, and must be set in order for the proxy pool to be activated.  Example:

```js
"MyPool1": {
	"target_hostname": "myserver.mydomain.com"
}
```

#### target_port

The `target_port` property allows you to customize the port number when connecting to the destination service.  By default, this follows the protocol, e.g. port 80 for HTTP and port 443 for HTTPS.  You should only need to specify this if you are connecting to a non-standard port.  Example:

```js
"MyPool1": {
	"target_port": 8080
}
```

#### use_keep_alives

The `use_keep_alives` property allows you to explicitly specify whether you want to use HTTP Keep-Alives on the destination service connections, or not.  The default is `true` (enabled).  Example:

```js
"MyPool1": {
	"use_keep_alives": false
}
```

#### cache_dns_sec

The `cache_dns_sec` property allows you to optionally cache the IP address of the destination service.  This is so the system doesn't have to query your DNS server for each new connection.  The value should be an integer, and represents the number of seconds to cache the IP address for.  The default is `0` (disabled).  For example, this would cache IPs for 1 minute:

```js
"MyPool1": {
	"cache_dns_sec": 60
}
```

#### max_concurrent_requests

The `max_concurrent_requests` property sets the maximum amount of concurrent requests to allow through.  That is, the number of parallel requests to allow hitting the back-end service at any given time.  If more concurrent requests come in, they are queued, or rejected if the queue is full (see [Throttling](#throttling) below for details).  The default is `0` (unlimited).  Example:

```js
"MyPool1": {
	"max_concurrent_requests": 100
}
```

#### max_requests_per_sec

The `max_requests_per_sec` property sets the maximum number of requests to allow through per second.  If this amount is met in the space of a second, the extra requests are queued, or rejected if the queue is full (see [Throttling](#throttling) below for details).  The default is `0` (unlimited).  Example:

```js
"MyPool1": {
	"max_requests_per_sec": 1000
}
```

#### max_queue_length

The `max_queue_length` property specifies the maximum number of requests that can be queued up.  Normally requests are routed instantly, but for those that exceed either the [max_concurrent_requests](#max_concurrent_requests) or [max_requests_per_sec](#max_requests_per_sec) limits, they are pushed onto a queue.  If the queue becomes full, additional requests are rejected.  See [Throttling](#throttling) below for details.  The default is `0` (unlimited queue size).  Example:

```js
"MyPool1": {
	"max_queue_length": 256
}
```

#### follow_redirects

The `follow_redirects` property allows the back-end service call to follow HTTP redirects, if one is encountered.  An HTTP redirect is a HTTP 301, 302, 307 or 308, along with a `Location` response header.  You should set this property to an integer, representing the maximum number of allowed redirects to follow.  The default is `false` (disabled).  Example:

```js
"MyPool1": {
	"follow_redirects": 5
}
```

#### http_user_agent

The `http_user_agent` property allows you to set a default `User-Agent` header to forward along with all requests.  This only applies if the client request doesn't already specify one.  The default is blank (empty string).  Example:

```js
"MyPool1": {
	"http_user_agent": "My Fun Proxy"
}
```

#### http_timeout_ms

The `http_timeout_ms` property allows you to set an HTTP timeout for back-end service requests.  This is measured as the *time to first byte*.  See the[pixl-request timeout documentation](https://github.com/jhuckaby/pixl-request#handling-timeouts) for more details on this.  The value should be an integer, and is measured in milliseconds.  Example (3 seconds):

```js
"MyPool1": {
	"http_timeout_ms": 3000
}
```

#### http_basic_auth

If your back-end service requires authentication (HTTP Basic Auth) you can provide it using the `http_basic_auth` property.  The format should be `USERNAME:PASSWORD`, with a colon in between.  Example:

```js
"MyPool1": {
	"http_basic_auth": "admin:12345"
}
```

#### append_to_x_forwarded_for

The `append_to_x_forwarded_for` property controls whether or not to append the client IP address to the `X-Forwarded-For` header, when forwarding the request along to the back-end service.  Most "proper" proxies should do this, and thus the default setting is `true` (enabled).  However, there are cases when you may want to disable it.  For example, if you are running a localhost proxy (i.e. your front-end app connects to the proxy on 127.0.0.1), then it may be useless or undesirable for your back-end service to see `127.0.0.1` as the last IP on the XFF header.  Example:

```js
"MyPool1": {
	"append_to_x_forwarded_for": false
}
```

#### resp_code_success_match

In order to determine if a request failed, the HTTP response code is checked (e.g. `200 OK`).  By default, all codes in the 200 - 399 range are considered a success, and anything outside of that range is an error.  You can customize this success range by supplying a regular expression string in the `resp_code_success_match` property:

```js
"MyPool1": {
	"resp_code_success_match": "^(2\\d\\d|3\\d\\d)$"
}
```

Errors are simply passed back to the client, but you may want to adjust the range to control logging.  Meaning, errors are logged separately from transactions, so if your back-end service routinely returns codes outside the default 200 - 399 range, you may want to expand the success match property so they aren't logged as errors.

#### retries

If the request to the back-end service fails, you have the option to retry it a number of times, before ultimately giving up and returning an error to the client.  This feature can be enabled by setting the `retries` property to a non-zero value, representing the maximum number of retries per client request.  By default this feature is disabled (`0`).  Example:

```js
"MyPool1": {
	"retries": 5
}
```

In order to determine if a request succeeded or failed, the HTTP response code is checked against a customizable success range.  See the [resp_code_success_match](#resp_code_success_match) property for details.

When a retry needs to occur, you may want to add a delay, as to not bombard the back-end service when it is having trouble.  To control this behavior, the following additional properties are available:

| Property Name | Type | Description |
|---------------|------|-------------|
| `error_retry_delay_base_ms` | Integer | The base (minimum) retry delay, in milliseconds.
| `error_retry_delay_mult_ms` | Integer | Multiply the number of errors in the last second by this value, and add to the base.
| `error_retry_delay_max_ms` | Integer | The maximum delay in milliseconds (never exceed this amount).

All three of these properties default to `0`.

The idea here is that the retry delay is an exponential back-off algorithm, based on previous second's error count.  So for each retry operation, it calculates the delay by starting with the base value (`error_retry_delay_base_ms`), then multiplying `error_retry_delay_mult_ms` by the number of errors received in the previous second, and adding that to the base.  Finally, the base + multiplication is clamped by the maximum (`error_retry_delay_max_ms`).  In this way as more and more errors occur, you can have the retry delay increase, reducing the bashing of the back-end service.  Here is an example configuration:

```js
"MyPool1": {
	"retries": 10,
	"error_retry_delay_base_ms": 100,
	"error_retry_delay_mult_ms": 20,
	"error_retry_delay_max_ms": 5000
}
```

So in this example we allow up to 10 retries per client request, and have a base (minimum) delay of 100ms per retry.  Then, if we recorded any errors during the last second, we multiply that error count by 20ms and add the result to the base value, not to exceed 5 seconds.

#### log_perf_ms

The `log_perf_ms` property allows you to set a performance threshold, above which all back-end service requests will be logged (including all the HTTP performance metrics).  This value is measured as the total request time to the back-end service, in milliseconds.  So for example, if you set this property to `100`, then all back-end requests that take 100ms and over will be logged as transactions.  Example configuration:

```js
"MyPool1": {
	"log_perf_ms": 100
}
```

See [Logging](#logging) below for more details.

#### log_transactions

The `log_transactions` property, when set to `true`, will log *every* back-end service request as a transaction, to the event log.  A transaction simply means that the category column is set to `transaction` instead of `debug`.  All transactions have the full request URL, response code, response headers, and performance metrics.  Example configuration:

```js
"MyPool1": {
	"log_transactions": true
}
```

Here is an example transaction log entry:

```
[1508477033.311][2017-10-19 22:23:53][joedark.local][MyPool1][transaction][http][Proxy Request Completed: HTTP 200 OK][{"url":"http://myservice.com:3012/sleep?ms=1000","http_code":200,"http_message":"OK","resp_headers":{"content-type":"application/json","x-joetest":"1234","server":"Test Server 1.0","content-length":"54","date":"Fri, 20 Oct 2017 05:23:53 GMT","connection":"keep-alive"},"perf_metrics":{"scale":1000,"perf":{"total":1015.569,"send":0,"connect":8.521,"wait":1004.409,"receive":1.821},"counters":{"bytes_sent":135,"bytes_received":228}},"request_id":""}]
```

See [Logging](#logging) below for more details.

Note that you can also log all incoming requests at the web server level (this is across all pools).  See the [pixl-server-web logging docs[(https://github.com/jhuckaby/pixl-server-web#logging) for details on enabling this.

#### log_errors

The `log_errors` property controls whether back-end service HTTP errors are logged.  The default is `true` (enabled).  If you want to disable this, set the property to `false`:

```js
"MyPool1": {
	"log_errors": false
}
```

Here is an example error log row:

```
[1508530714.066][2017-10-20 13:18:34][joedark.local][MyPool1][error][500][Proxy Request Error: HTTP 500 Internal Server Error][{"url":"http://myservice.com:3012/sleep?ms=1000","http_code":500,"http_message":"Internal Server Error","resp_headers":{},"perf_metrics":{"scale":1000,"perf":{"total":0.917},"counters":{}},"error_details":"Error: Connection Refused: Failed to connect to host: myservice.com","request_id":""}]
```

The proxy determines if a request is an error based on the response code.  See the [resp_code_success_match](#resp_code_success_match) property for details.

See [Logging](#logging) below for more details.

#### insert_request_headers

The `insert_request_headers` object allows you include additional HTTP headers along with the request to the back-end service.  These will replace any existing headers with the same names (case-sensitive).  Example:

```js
"MyPool1": {
	"insert_request_headers": {
		"Via": "PixlProxy 1.0"
	}
}
```

#### insert_response_headers

The `insert_response_headers` object allows you include additional HTTP headers along with the response back to the client.  These will replace any existing headers with the same names (case-sensitive).  Example:

```js
"MyPool1": {
	"insert_response_headers": {
		"Via": "PixlProxy 1.0"
	}
}
```

### Advanced Properties

Here are a few advanced properties that you should probably never have to worry about, but are listed here for reference and special use cases.

#### scrub_request_headers

**Note:** This is an advanced property, and probably never needs to be changed from its default value.

The `scrub_request_headers` property contains a regular expression wrapped in a string, which is matched against all incoming client HTTP request headers.  If any match (case-insensitively), they are scrubbed (removed) from the downstream back-end service request.  Here is the default value:

```js
"MyPool1": {
	"scrub_request_headers": "^(host|x\\-proxy|x\\-proxy\\-\\w+|expect|content\\-length|connection)$"
}
```

The reason for scrubbing these headers it that they get either removed or replaced in the back-end request, so it is useless and often times an error to include them.  For example, the `Host` header is completely replaced every time, and `Connection` may differ between the client and back-end requests.

#### scrub_response_headers

**Note:** This is an advanced property, and probably never needs to be changed from its default value.

The `scrub_response_headers` property contains a regular expression wrapped in a string, which is matched against all outgoing HTTP response headers.  If any match (case-insensitively), they are scrubbed (removed) from the client response.  Here is the default value:

```js
"MyPool1": {
	"scrub_response_headers": "^(transfer\-encoding)$"
}
```

The `Transfer-Encoding` header is scrubbed because it is controlled by the underlying Node.js HTTP library, and may be added or not, as it is deemed necessary.  It is usually an error to "carry over" this header from one request to another.

#### min_stream_size

**Note:** This is an advanced property, and probably never needs to be changed from its default value.

The `min_stream_size` property represents the cutoff point where all HTTP responses larger than this value will be piped using streams.  The default value is 128K, but the property is expressed raw bytes.  Example:

```js
"MyPool1": {
	"min_stream_size": 131072
}
```

This exists because it is typically faster to use a memory buffer to proxy the back-end response payload to the client, but doing this with large payloads can cause memory usage spikes, and sometimes even socket errors.  So if any response payload is over this size (or has no `Content-Length` header at all) a stream is used instead of a buffer.

#### throttle_requeue_delay_ms

**Note:** This is an advanced property, and probably never needs to be changed from its default value.

The `throttle_requeue_delay_ms` property represents the delay in milliseconds before a throttled request is re-enqueued.  The default value is 100ms.  This is non-zero because if we were to immediately re-enqueue all throttled requests, it would "bash" the queue during the second that was already maxed out.  Meaning, the requests would be in an constant loop until the next second comes around, and the queue allows in another chunk of requests.

```js
"MyPool1": {
	"throttle_requeue_delay_ms": 100
}
```

## Command-Line Usage

PixlProxy comes with a simple command-line control script called `proxyctl`.  It should already be symlinked into your PATH, assuming you installed the module via `sudo npm install -g pixl-proxy`.  It accepts a single command-line argument to start, stop, and a few other things.  Examples:

```
proxyctl start
proxyctl stop
proxyctl restart
```

Note that if you have your web server listening on port 80, 443, or any port under 1,024, then you'll need to run these commands as root.

Here is the full command list:

| Command | Description |
|---------|-------------|
| `help` | Show usage information. |
| `start` | Start PixlProxy as a background service. |
| `stop` | Stop PixlProxy and wait until it actually exits. |
| `restart` | Calls stop, then start (hard restart). |
| `status` | Checks whether PixlProxy is currently running. |
| `debug` | Start the service in debug mode (see [Debugging](#debugging) below). |
| `config` | Edit the config file in your editor of choice (via `EDITOR` environment variable). |
| `showconfig` | Reveal the location of the config file path on disk. |
| `boot` | Install PixlProxy as a startup service (see [Server Reboot](#server-reboot) below). |
| `unboot` | Remove PixlProxy from the startup services. |

### Debugging

To start PixlProxy in debug mode, issue this command:

```
proxyctl debug
```

This will start the service as a foreground process (not a daemon), and echo the event log straight to the console.  This is a great way to troubleshoot issues.  Hit Ctrl-C to exit.

Note that you may have to use `sudo` or become the root user to start the service, if your web server is listening on any port under 1,024 (i.e. port 80).

### Server Reboot

If you want to have the PixlProxy daemon start up automatically when your server reboots, use you can use the special `boot` command, which will register it with the operating system's startup service (i.e. [init.d](https://bash.cyberciti.biz/guide//etc/init.d) on Linux, [LaunchAgent](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) on macOS, etc.).  You only need to type this once:

```
sudo proxyctl boot
```

To unregister and remove PixlProxy from the server startup services, type this:

```
sudo proxyctl unboot
```

See the [pixl-boot](https://github.com/jhuckaby/pixl-boot) module for more details on how this works.

### Upgrading

To upgrade to the latest PixlProxy version, you can use the `npm update` command.  Your local configuration file will *not* be touched.  Assuming you installed PixlProxy globally, and it is currently running, then issue these commands to upgrade to the latest stable:

```
sudo proxyctl stop
sudo npm update -g pixl-proxy
sudo proxyctl start
```

## Request Routing

PixlProxy offers several methods for routing incoming requests to your back-end services.  You can automatically match pools based on request method, URI, hostname, or a custom `X-Proxy` header value.  Alternatively, if you just have a single pool that should match everything, you can do that as well.  These methods are all detailed in the following four sections:

### Single Pool

In the simplest case, you have a single back-end service that *all* requests should route to.  To set this up, define a single `pool` entry, omit all matching criteria, include the target hostname and any other settings you need, and you're good to go.  Minimal example:

```js
"PixlProxy": {
	"pools": {
		"MyPool1": {
			"target_protocol": "http",
			"target_hostname": "test.myserver.com",
			"target_port": 80
		}
	}
}
```

### Request Matching

If you have multiple back-end destinations that you want to route requests to, you can any of the following three pool properties to match incoming requests: [method_match](#method_match), [host_match](#host_match) and/or [uri_match](#uri_match).  Example:

```js
"PixlProxy": {
	"pools": {
		"MyPool1": {
			"method_match": "^GET$",
			"host_match": "^localhost$",
			"uri_match": "^/proxy",
			
			"target_hostname": "test.myserver.com"
		}
	}
}
```

Here we are specifying all three match properties, so the request method must be GET, **and** the hostname must be `localhost`, **and** and URI must start with `/proxy`.  Then and only then will the request be routed to the `test.myserver.com` back-end service.  Any match properties that are omitted mean "match all" in that category.

### X-Proxy Header

Another way to route incoming requests is to use a `X-Proxy` request header.  If this request header is present, and matches any of your Pool IDs, it will be routed there (note that any method/hostname/URI criteria must also match, if specified).

Routing using the `X-Proxy` header makes the most sense when you also include the [x_proxy_only](#x_proxy_only) setting.  Setting this pool property to `true` means that **only** requests that include the `X-Proxy` header (with a value that matches the Pool ID) will be routed.  Example pool configuration:

```js
"PixlProxy": {
	"pools": {
		"MyPool1": {
			"x_proxy_only": true,
			"target_hostname": "test.myserver.com"
		}
	}
}
```

So in this case requests will only be routed to the pool if they include a `X-Proxy` header, and it is set to `MyPool1` exactly (case-sensitive).  Example HTTP request which would be routed to our pool:

```
GET /proxy HTTP/1.1
Host: localhost
User-Agent: MyTestClient/1.0
X-Proxy: MyPool1
```

### Default Pool

If you want to have a "catch-all" pool, which will handle all requests that don't match any other pool, simply give it an ID of `default`.  This is a special ID that is only considered last, after all other pools are checked for a matching request.  Example:

```js
"PixlProxy": {
	"pools": {
		"default": {
			"target_protocol": "http",
			"target_hostname": "test.myserver.com",
			"target_port": 80
		}
	}
}
```

The difference between the `default` pool and a normal pool without any matching criteria is the default pool is always checked *last* (i.e. lowest priority).  All other pools have effectively equal priority, and the check order is undefined.

Note that the default pool and [serve_static_files](#serve_static_files) are mutually exclusive features.

## Throttling

PixlProxy offers several ways to throttle requests to your back-end services.  You can set limits on the number of requests per second, as well as the number of concurrent requests.  Any requests that exceed your limits can be queued, or rejected immediately.

To throttle based on the request rate, set the [max_requests_per_sec](#max_requests_per_sec) property.  Separately or in addition to this, you can also throttle by the number of concurrent requests, by setting the [max_concurrent_requests](#max_concurrent_requests) property.  If you use both, then whichever is reached first becomes the limiting factor.  Example configuration:

```js
"PixlProxy": {
	"pools": {
		"MyPool1": {
			"target_hostname": "test.myserver.com",
			"max_concurrent_requests": 10,
			"max_requests_per_sec": 1000
		}
	}
}
```

By default there are no request rate or concurrency limits.  However, see [Max Client Connections](#max-client-connections) below.

Incoming requests over your limits will be queued, and serviced as soon as possible.  You also have control over the maximum size of the queue, by setting the [max_queue_length](#max_queue_length) property.  If a queue limit is specified and it fills up, any additional incoming requests are rejected with a `HTTP 429 Too Many Requests` response.  Example use:

```js
"PixlProxy": {
	"pools": {
		"MyPool1": {
			"target_hostname": "test.myserver.com",
			"max_concurrent_requests": 10,
			"max_requests_per_sec": 1000,
			"max_queue_length": 100
		}
	}
}
```

Note that setting a `max_queue_length` of `0` means *infinite* (which is also the default).  If you don't want requests to be queued, set the max queue length to `1` instead.

### Max Client Connections

In addition to the throttling methods available in each pool, you can also limit connections globally at the web server level, by setting the [http_max_connections](https://github.com/jhuckaby/pixl-server-web#http_max_connections) property in the `WebServer` object.  This is a hard upper limit of allowed concurrent client-side connections.  If this limit is reached, new client connections are rejected immediately (by a socket hard-close).  Please set this property with extreme care.  It defaults to `0` (infinite, no limit).

Note that the `http_max_connections` should always be equal or greater than all of your pool `max_queue_length` values added together.  Remember, this applies to the whole proxy server globally, and every queued request will have its own client socket connection open.

## Queue System

If you have a use case where the client doesn't need to wait for the response from the back-end service, you can optionally send it "blind".  That is, the client request will be *immediately* answered, but the actual back-end request is queued up, and will execute in the background, keeping things within your throttling limits.  This is basically an in-memory message queue, except that all messages are HTTP requests.

To use this, simply include a `X-Proxy-Queue` header with your client HTTP requests, and set it to `1` (or any true value).  This tells PixlProxy that the request should be enqueued, and executed in the background, returning a response to the client instantly.  The client response is a JSON document which will have a unique `request_id` identifier.  Example HTTP request:

```
GET /proxy HTTP/1.1
Host: localhost
User-Agent: MyTestClient/1.0
X-Proxy: MyPool1
X-Proxy-Queue: 1
```

And here is an example JSON response, sent back to the client immediately (before the back-end request is actually made):

```js
{
	"code": 0,
	"description": "Proxy request enqueued successfully.",
	"request_id": "ef233cc0cf219ec14eb629be00bcf52bed9bc1a556d643ff89ffb76eaa0a4dd3"
}
```

The `request_id` value can be used to correlate your request with the PixlProxy logs at a later time.  For example, if the back-end request ultimately fails, it will be logged as an error (assuming you have [log_errors](#log_errors) enabled), and that log entry will include the corresponding `request_id`, so you can match it up with your application data.

The same goes for successfully completed back-end requests.  If you have [log_transactions](#log_transactions) enabled, your queued back-end request will be logged upon completion, that that log entry will include the corresponding `request_id` that was returned to your client.  Example successful transaction from a queued request:

```
[1508560380.348][2017-10-20 21:33:00][joedark.local][MyPool1][transaction][http][Proxy Request Completed: HTTP 200 OK][{"url":"http://127.0.0.1:3012/sleep?ms=1000","method":"GET","req_headers":{"host":"127.0.0.1:3020","user-agent":"curl/7.54.0","accept":"*/*","x-proxy-queue":"1"},"http_code":200,"http_message":"OK","resp_headers":{"content-type":"application/json","x-joetest":"1234","server":"Test Server 1.0","content-length":"54","date":"Sat, 21 Oct 2017 04:33:00 GMT","connection":"keep-alive"},"perf_metrics":{"scale":1000,"perf":{"total":1031.547,"send":0,"connect":10.345,"wait":1018.643,"receive":1.621},"counters":{"bytes_sent":135,"bytes_received":228}},"request_id":"ef233cc0cf219ec14eb629be00bcf52bed9bc1a556d643ff89ffb76eaa0a4dd3"}]
```

See [Logging](#logging) below for more details on the log format.

Keep in mind that all queued requests are held in memory, so it is recommended you set your pool's [max_queue_length](#max_queue_length) accordingly, and watch your server's memory usage.  If you are queuing HTTP POSTs that include file uploads, those are stored to disk temporarily (in the web server's [http_temp_dir](https://github.com/jhuckaby/pixl-server-web#http_temp_dir) directory), and not stored in RAM.

**Note**: This queue system should *not* be used for mission-critical data.  Queued requests can be lost if the proxy server is shut down improperly (crash or power loss), or your back-end service goes down and you exhaust all your retries, or the queue fills up.  You should only consider using this system for *non-essential* background requests that you simply don't want your client to wait for, but your application will survive if some requests ultimately fail to reach the destination.

## JSON Stats API

PixlProxy keeps internal statistics on throughput and performance, which are logged every second (see [Logging](#logging) below).  However, if you also want to expose this data via a HTTP JSON REST service, you can do this by setting the [stats_uri_match](#stats_uri_match) property, which both enables the feature, and sets its URI endpoint.  Note that this property needs to live in the outer `PixlProxy` object, and is not associated with a particular pool.  Example:

```js
"PixlProxy": {
	"stats_uri_match": "^/proxy-stats",
	"pools": { /* your pools */ }
}
```

This would enable the Stats API on the `/proxy-stats` URI endpoint.  Hit it with any HTTP GET request, and it'll emit stats in the response.  Add `?pretty=1` if you would like the JSON to be pretty-printed.  Example:

```js
{
	"pools": {
		"MyPool1": {
			"counters": {
				"requests": 368,
				"bytes_sent": 104144,
				"bytes_received": 93104,
				"cur_pending_reqs": 0,
				"cur_executing_reqs": 1,
				"cur_client_conns": 2,
				"cur_server_conns": 1
			},
			"minimums": {
				"total": 0.563,
				"send": 0.106,
				"wait": 0.406,
				"receive": 0.025
			},
			"maximums": {
				"total": 22.753,
				"send": 2.186,
				"wait": 20.724,
				"receive": 0.111
			},
			"averages": {
				"total": 0.83,
				"send": 0.13,
				"wait": 0.64,
				"receive": 0.04
			},
			"scale": 1000
		}
	},
	"web": { /* see below */ }
}
```

As you can see, the stats are in a top-level `pools` object, and they are split out for each of your active pools.  In this case we only have one, `MyPool1`, which houses all of its own stats within.  The reported stats are always for exactly one full second of time (never a partial second, so it's always for the last full second).  In this way you can easily calculate things like requests per second, bytes per second, etc.

The `counters` object contains simple counters that have accumulated for exactly one second.  Here are the properties you will find there:

| Property Name | Description |
|---------------|-------------|
| `requests` | The total number of back-end requests served for the last second (i.e. current requests per second). |
| `bytes_sent` | The total number of bytes sent to the back-end service for the last second. |
| `bytes_received` | The total number of bytes received from the back-end service for the last second. |
| `cur_pending_reqs` | The current number of pending requests in the queue, waiting to be sent. |
| `cur_executing_reqs` | The current number of requests being executed (requests in progress to the back-end service). |
| `cur_client_conns` | The current number of open client socket connections for this pool. |
| `cur_server_conns` | The current number of open back-end service connections for this pool. |

The `minimums`, `maximums` and `averages` objects contain performance metrics for the last second.  The properties within these objects represent a particular phase of the downstream HTTP request to the back-end service, and its elapsed time in milliseconds.  For example, in the JSON stats shown above, the average total time for all the back-end service requests was 0.83ms.  However, the longest request took 22.753ms total time, as you can see in the `maximums` section.

Here are all the performance metrics that are tracked, and you may see in the `minimums`, `maximums` and `averages` objects:

| Metric | Description |
|--------|-------------|
| `dns` | Time to resolve the hostname to an IP address via DNS.  Omitted if cached, or you specify an IP on the URL. |
| `connect` | Time to connect to the remote socket (omitted if using Keep-Alives and reusing a host). |
| `send` | Time to send the request data (typically for POST / PUT).  Also includes SSL handshake time (if HTTPS). |
| `wait` | Time spent waiting for the server response (after request is sent). |
| `receive` | Time spent downloading data from the server (after headers received). |
| `decompress` | Time taken to decompress the response (if encoded with Gzip or Deflate). |
| `total` | Total time of the entire HTTP transaction. |

For more details on performance metrics, please see the [pixl-request performance metrics](https://github.com/jhuckaby/pixl-request#performance-metrics) docs.

The JSON Stats API is protected by an ACL, so only "internal" requests can access it.  This is accomplished by using the ACL feature in the web server, for the stats API endpoint.  By default, the ACL is restricted to localhost, plus the [IPv4 private reserved space](https://en.wikipedia.org/wiki/Private_network), but you can customize it by including a [http_default_acl](https://github.com/jhuckaby/pixl-server-web#http_default_acl) property in your `WebServer` configuration.  Please see the [pixl-server-web ACL](https://github.com/jhuckaby/pixl-server-web#access-control-lists) documentation for more details on this.

### Web Server Stats

The PixlProxy Stats API also includes stats from the web server, which will be in the `web` object.  Here is an example of what that looks like:

```js
"web": {
	"server": {
		"uptime_sec": 91,
		"hostname": "joedark.local",
		"ip": "192.168.3.20",
		"name": "PixlProxy",
		"version": "1.0.0"
	},
	"stats": {
		"total": {
			"st": "mma",
			"min": 1.088,
			"max": 25.037,
			"total": 590.8020000000001,
			"count": 368,
			"avg": 1.6054402173913047
		},
		"read": {
			"st": "mma",
			"min": 0.003,
			"max": 0.012,
			"total": 1.2879999999999965,
			"count": 368,
			"avg": 0.0034999999999999905
		},
		"process": {
			"st": "mma",
			"min": 0.829,
			"max": 24.602,
			"total": 460.7950000000003,
			"count": 368,
			"avg": 1.2521603260869574
		},
		"write": {
			"st": "mma",
			"min": 0.205,
			"max": 19.688,
			"total": 125.00300000000013,
			"count": 368,
			"avg": 0.33968206521739164
		},
		"bytes_in": 105248,
		"bytes_out": 99728,
		"num_requests": 368
	},
	"sockets": {
		"c3001": {
			"state": "processing",
			"ip": "::ffff:127.0.0.1",
			"proto": "http",
			"port": 3020,
			"elapsed_ms": 0.212232,
			"num_requests": 6,
			"bytes_in": 3132,
			"bytes_out": 50911,
			"ips": [
				"::ffff:127.0.0.1"
			],
			"method": "GET",
			"uri": "/proxy-stats?pretty=1",
			"host": "127.0.0.1:3020"
		},
		"c11952": {
			"state": "idle",
			"ip": "::ffff:127.0.0.1",
			"proto": "http",
			"port": 3020,
			"elapsed_ms": 0,
			"num_requests": 0,
			"bytes_in": 0,
			"bytes_out": 0
		}
	},
	"recent": []
}
```

Please see the [pixl-server-web stats](https://github.com/jhuckaby/pixl-server-web#stats) documentation for more details on this data.

## Keep-Alives

PixlProxy supports HTTP Keep-Alives on both the front and back ends.  It is highly recommended you use this wherever possible, but understandable that there are cases where you will want to disable it.  In this case you have control over both ends of the proxy.

For enabling Keep-Alives on the front-end, set the web server's [http_keep_alives](https://github.com/jhuckaby/pixl-server-web#http_keep_alives) property in the `WebServer` configuration object.  This should be set to one of three strings, which specify different Keep-Alive behaviors:

| Value | Description |
|-------|-------------|
| `"default"` | This enables Keep-Alives for all incoming connections by default, unless the client specifically requests a close connection. |
| `"request"` | This disables Keep-Alives for all incoming connections by default, unless the client specifically requests a Keep-Alive connection. |
| `"close"` | This completely disables Keep-Alives for all incoming connections. |

Example configuration:

```js
"WebServer": {
	"http_keep_alives": "default"
}
```

See the [pixl-server-web docs](https://github.com/jhuckaby/pixl-server-web#http_keep_alives) for more details.

For Keep-Alives on the back-end, you can configure this separately for each of your pools.  Simply set the [use_keep_alives](#use_keep_alives) property.  It defaults to `true`, so you only need to specify if you want to *disable* it.  Example configuration:

```js
"MyPool1": {
	"use_keep_alives": false
}
```

## HTTPS

PixlProxy supports HTTPS on both the front and back ends.  To enable it on the front-end web server, you will need an SSL certificate for your domain (both `.crt` and `.key` files), and then you need to set a few properties in the `WebServer` configuration object:

| Property Name | Type | Description |
|---------------|------|-------------|
| `https` | Boolean | Set this to `true` to enable front-end HTTPS support in the web server. |
| `https_port` | Integer | Set this to the port you want to listen for HTTPS requests on (`443` is the default). |
| `https_cert_file` | String | Set this to a filesystem path to your `.crt` file for your SSL certificate. |
| `https_key_file` | String | Set this to a filesystem path to your `.key` file for your SSL certificate. |

Note that the web server listens for HTTPS requests *in addition to* normal HTTP requests.  If you only want to serve HTTPS, then set the [https_force](#https_force) property, which will redirect all incoming HTTP requests to HTTPS.

See the [pixl-server-web HTTPS](https://github.com/jhuckaby/pixl-server-web#https) documentation for more details.

When an HTTPS request is received, a special request header is injected into the forwarded back-end request:

```
X-Forwarded-Proto: https
```

This is so your back-end service can detect that HTTPS/SSL was used on the front-end, even if the proxy-to-back-end request itself was plain HTTP.  This is a de-facto standard header used by load balancers such as Amazon Web Services' Elastic Load Balancer.

For HTTPS on the back-end, all you have to do is set your [target_protocol](#target_protocol) pool property to `https`.  This will use HTTPS when connecting to your back-end service (i.e. it'll construct `https://` URLs).

Please note that if you need to connect to a back-end HTTPS service that uses self-signed SSL certificates, you may have to set the [validate_ssl_certs](#validate_ssl_certs) property to `false`.

## Content-Encoding

PixlProxy supports both passive and active compression (i.e. content encoding).  Passive compression is automatic, meaning if the back-end service returns a compressed (encoded) response, this is passed directly through to the client, without touching it.  However, if you also want *active* compression, meaning you want PixlProxy to compress an otherwise uncompressed text response, you can do this by using some features provided by [pixl-server-web](https://github.com/jhuckaby/pixl-server-web).

These three properties control active compression for HTTP responses, and all should go into the `WebServer` configuration object:

| Property Name | Type | Description |
|---------------|------|-------------|
| [http_gzip_text](https://github.com/jhuckaby/pixl-server-web#http_gzip_text) | Boolean | Set this to `true` to compress text-based responses that aren't already compressed. |
| [http_regex_text](https://github.com/jhuckaby/pixl-server-web#http_regex_text) | String | This is a regular expression matched against the response `Content-Type` header.  Only matching responses are compressed. |
| [http_gzip_opts](https://github.com/jhuckaby/pixl-server-web#http_gzip_opts) | Object | This allows you to customize the Gzip settings, such as compression level and memory usage. |

Note that active compression only kicks in if the response isn't already compressed, and the client declares support via the `Accept-Encoding` request header.  If this header is missing or doesn't include `gzip` then PixlProxy won't compress the response.

# Logging

PixlProxy uses the logging system built into [pixl-server](https://github.com/jhuckaby/pixl-server#logging).  Essentially there is one combined "event log" which contains debug messages, errors and transactions.  The `component` column will be set to either `PixlProxy`, `WebServer` or one of your own Pool IDs.  Most debug messages will be pool-specific.

The general logging configuration is controlled by these three top-level global properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `log_dir` | String | Directory path where event log will be stored.  Can be a fully-qualified path, or relative from the PixlProxy base directory. |
| `log_filename` | String | Event log filename, joined with `log_dir`. |
| `debug_level` | Integer | Debug logging level, larger numbers are more verbose, 1 is quietest, 10 is loudest. |

The global `debug_level` property controls the verbosity of debug log messages, but errors and transactions are controlled by the following pool-specific properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| [log_transactions](#log_transactions) | Boolean | Set this to `true` to log *all* requests as transactions. |
| [log_perf_ms](#log_perf_ms) | Integer | Log transactions if the total back-end request time exceeds this limit (in milliseconds). |
| [log_errors](#log_errors) | Boolean | By default all errors are logged.  Set this to `false` to disable error logging. |

## Debug Log

Log entries with the `category` set to `debug` are debug messages, and have a verbosity level from 1 to 10.

Here is an example log excerpt showing a typical startup with one pool (`MyPool1`).  In all these log examples the first 3 columns (`hires_epoch`, `date` and `hostname`) are omitted for display purposes.  The columns shown are `component`, `category`, `code`, `msg`, and `data`.

```
[PixlProxy][debug][1][PixlProxy v1.0.0 Starting Up][]
[PixlProxy][debug][2][Server IP: 10.0.1.4, Daemon PID: 26024][]
[PixlProxy][debug][3][Starting component: WebServer][]
[WebServer][debug][2][pixl-server-web v1.0.25 starting up][]
[WebServer][debug][2][Starting HTTP server on port: 3020][]
[PixlProxy][debug][3][Starting component: PixlProxy][]
[PixlProxy][debug][3][PixlProxy engine starting up][["/usr/local/bin/node","/Users/jhuckaby/node_modules/pixl-proxy/lib/main.js","--debug","--echo"]]
[PixlProxy][debug][4][Setting up pool: MyPool1][{"target_protocol":"http","target_hostname":"127.0.0.1","target_port":3012,"use_keep_alives":true,"cache_dns_sec":60,"max_concurrent_requests":10,"max_requests_per_sec":1000,"max_queue_length":10,"follow_redirects":false,"http_timeout_ms":30000,"append_to_x_forwarded_for":false,"retries":5,"log_perf_ms":100,"log_transactions":1}]
[WebServer][debug][3][Adding custom URI handler: /^\/proxy-stats/: PixlProxy Stats][]
[WebServer][debug][3][Adding custom URI handler: /.+/: PixlProxy][]
[PixlProxy][debug][2][Startup complete, entering main loop][]
```

Here are all the debug entries for an example request (with the debug level set to 9):

```
[WebServer][debug][8][New incoming HTTP connection: c1][{"ip":"::ffff:127.0.0.1","num_conns":1}]
[WebServer][debug][8][New HTTP request: GET /sleep?ms=1000 (::ffff:127.0.0.1)][{"socket":"c1","version":"1.1"}]
[WebServer][debug][9][Incoming HTTP Headers:][{"host":"127.0.0.1:3020","user-agent":"curl/7.54.0","accept":"*/*"}]
[WebServer][debug][6][Invoking handler for request: GET /sleep: PixlProxy][]
[MyPool1][debug][9][Enqueuing request: GET /sleep?ms=1000][{"host":"127.0.0.1:3020","user-agent":"curl/7.54.0","accept":"*/*"}]
[MyPool1][debug][8][Proxying GET request: http://127.0.0.1:3012/sleep?ms=1000][{"User-Agent":"curl/7.54.0","Accept":"*/*","Via":"PixlProxy 1.0"}]
[MyPool1][debug][5][Creating new proxy socket: p1][]
[MyPool1][debug][8][Proxy request completed: HTTP 200 OK][{"resp_headers":{"content-type":"application/json","x-joetest":"1234","server":"Test Server 1.0","content-length":"54","date":"Sat, 21 Oct 2017 23:39:29 GMT","connection":"keep-alive"},"perf_metrics":{"scale":1000,"perf":{"total":1029.285,"send":0,"connect":9.124,"wait":1017.34,"receive":1.958},"counters":{"bytes_sent":135,"bytes_received":228}}}]
[WebServer][debug][9][Sending HTTP response: 200 OK][{"Content-Type":"application/json","X-JoeTest":"1234","Server":"Test Server 1.0","Content-Length":"54","Date":"Sat, 21 Oct 2017 23:39:29 GMT","Connection":"keep-alive","Via":"PixlProxy 1.0"}]
[WebServer][debug][9][Request complete][]
[WebServer][debug][9][Response finished writing to socket][]
[WebServer][debug][9][Request performance metrics:][{"scale":1000,"perf":{"total":1038.706,"read":0.263,"process":1034.178,"write":2.965},"counters":{"bytes_in":91,"bytes_out":246,"num_requests":1}}]
[WebServer][debug][9][Keeping socket open for keep-alives: c1][]
[WebServer][debug][8][HTTP connection has closed: c1][{"ip":"::ffff:127.0.0.1","total_elapsed":1045,"num_requests":1,"bytes_in":91,"bytes_out":246}]
```

Here is an example of performance metrics, which are logged every second for every pool (if there is any activity at all).  This is logged as a level 2 debug event:

```
[MyPool1][debug][2][Average Performance Metrics][{"scale":1000,"counters":{"requests":1,"bytes_sent":135,"bytes_received":228,"cur_pending_reqs":0,"cur_executing_reqs":0,"cur_client_conns":0,"cur_server_conns":1},"minimums":{"total":1020.389,"send":0,"connect":12.133,"wait":1005.918,"receive":1.521},"maximums":{"total":1020.389,"send":0,"connect":12.133,"wait":1005.918,"receive":1.521},"averages":{"total":1020.38,"send":0,"connect":12.13,"wait":1005.91,"receive":1.52}}]
```

And here is the shutdown sequence:

```
[PixlProxy][debug][1][Caught SIGINT][]
[PixlProxy][debug][1][Shutting down][]
[PixlProxy][debug][3][Stopping component: PixlProxy][]
[PixlProxy][debug][2][Shutting down PixlProxy][]
[MyPool1][debug][3][Shutting down pool: MyPool1][{"current_pending_requests":0,"current_executing_requests":0}]
[MyPool1][debug][3][Pool shutdown complete][]
[PixlProxy][debug][3][Stopping component: WebServer][]
[WebServer][debug][2][Shutting down HTTP server][]
[PixlProxy][debug][2][Shutdown complete, exiting][]
[WebServer][debug][3][HTTP server has shut down.][]
[MyPool1][debug][5][Proxy socket has closed: p1][]
```

## Error Log

In general, all errors are client HTTP responses.  The `code` column is the HTTP response code (e.g. 404, 500), and the `msg` column will contain details about the error (as well as the `data` column in most cases).  Here is an example error:

```
[MyPool1][error][500][Proxy Request Error: HTTP 500 Internal Server Error][{"url":"http://127.0.0.1:3012/sleep?ms=1000","method":"GET","req_headers":{"host":"127.0.0.1:3020","user-agent":"curl/7.54.0","accept":"*/*"},"http_code":500,"http_message":"Internal Server Error","resp_headers":{},"perf_metrics":{"scale":1000,"perf":{"total":1.099},"counters":{}},"error_details":"Error: Connection Refused: Failed to connect to host: 127.0.0.1","request_id":""}]
```

The `data` column contains detailed information about the error in serialized JSON format.  Here is an example pretty-printed for display purposes:

```js
{
	"url": "http://127.0.0.1:3012/sleep?ms=1000",
	"method": "GET",
	"req_headers": {
		"host": "127.0.0.1:3020",
		"user-agent": "curl/7.54.0",
		"accept": "*/*"
	},
	"http_code": 500,
	"http_message": "Internal Server Error",
	"resp_headers": {},
	"perf_metrics": {
		"scale": 1000,
		"perf": {
			"total": 1.099
		},
		"counters": {}
	},
	"error_details": "Error: Connection Refused: Failed to connect to host: 127.0.0.1",
	"request_id": ""
}
```

In some cases errors are generated by the proxy, instead of being passed in from the back-end service.  Here is an example of one of these internal errors:

```
[1508558270.705][2017-10-20 20:57:50][joedark.local][TestPool][error][429][Proxy queue is full: 10 requests pending][{"uri":"/sleep?ms=100","method":"GET","req_headers":{"x-proxy":"TestPool","accept-encoding":"gzip, deflate","user-agent":"PixlRequest 1.0.17","host":"127.0.0.1:3020","connection":"close"}}]
```

## Transaction Log

A transaction is a completed back-end HTTP request.  These are only logged if explicitly enabled via the [log_transactions](#log_transactions) pool configuration property.  Here is an example transaction:

```
[MyPool1][transaction][http][Proxy Request Completed: HTTP 200 OK][{"url":"http://127.0.0.1:3012/sleep?ms=1000","method":"GET","req_headers":{"host":"127.0.0.1:3020","user-agent":"curl/7.54.0","accept":"*/*"},"http_code":200,"http_message":"OK","resp_headers":{"content-type":"application/json","x-joetest":"1234","server":"Test Server 1.0","content-length":"54","date":"Sat, 21 Oct 2017 23:39:29 GMT","connection":"keep-alive"},"perf_metrics":{"scale":1000,"perf":{"total":1029.285,"send":0,"connect":9.124,"wait":1017.34,"receive":1.958},"counters":{"bytes_sent":135,"bytes_received":228}},"request_id":""}]
```

The `data` column contains detailed information about the transaction in serialized JSON format.  Here is an example pretty-printed for display purposes:

```js
{
	"url": "http://127.0.0.1:3012/sleep?ms=1000",
	"method": "GET",
	"req_headers": {
		"host": "127.0.0.1:3020",
		"user-agent": "curl/7.54.0",
		"accept": "*/*"
	},
	"http_code": 200,
	"http_message": "OK",
	"resp_headers": {
		"content-type": "application/json",
		"x-joetest": "1234",
		"server": "Test Server 1.0",
		"content-length": "54",
		"date": "Sat, 21 Oct 2017 23:39:29 GMT",
		"connection": "keep-alive"
	},
	"perf_metrics": {
		"scale": 1000,
		"perf": {
			"total": 1029.285,
			"send": 0,
			"connect": 9.124,
			"wait": 1017.34,
			"receive": 1.958
		},
		"counters": {
			"bytes_sent": 135,
			"bytes_received": 228
		}
	},
	"request_id": ""
}
```

You can also log transactions at the web server level.  These transactions represent the client side of the request, and are only logged when the response makes it all the way back through the client socket.  To enable transaction logging at the web server level, use these two `WebServer` configuration properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| [http_log_requests](https://github.com/jhuckaby/pixl-server-web#http_log_requests) | Boolean | Set this to `true` if you want client HTTP requests to be logged as transactions. |
| [http_regex_log](https://github.com/jhuckaby/pixl-server-web#http_regex_log) | String | Use this feature to only log *some* requests, based on a URI regular expression match. |

Please note that client request transaction logging is a global setting, and affects all of your proxy configurations.  For more details, please see the [pixl-server-web logging](https://github.com/jhuckaby/pixl-server-web#logging) documentation.

# Benchmarks

The PixlProxy benchmark test results are below.  Testing was performed on a single AWS c4.2xlarge instance with Node.js v6.11, and Apache 2.4 as the back-end web service.  Keep-Alives were used on the front and back ends, and everything was served over localhost.  The average total round trip time from test script through the proxy to Apache and back was **0.56ms**.  This is over 24 hours at 500 req/sec (43M total requests).  For comparison, hitting Apache directly was about **0.2ms** average total time, so PixlProxy is adding about **0.36ms** to each request.

Only two small hiccups over 10ms were recorded by the test script in 24 hours of testing, and both were in the first second.  The very first request was 38ms total, due mainly to Node.js stretching its legs (loading code and libraries), and the TCP connect time.  The second hiccup was request #132, and measured at 13ms (was probably the first second rollover, where stats are collected).  After those two initial burps, however, it was completely smooth sailing for 24 full hours.  No garbage collection stalls were seen.

Memory usage was only 79MB at the end of the test, which is well within the Node.js normal range.

```
┌────────────┬──────────┬──────────┬──────────┬────────────┐
│ Metric     │ Minimum  │ Average  │ Maximum  │ Samples    │
├────────────┼──────────┼──────────┼──────────┼────────────┤
│ DNS        │ 0 ms     │ 0 ms     │ 0 ms     │ 0          │
│ Connect    │ 3.33 ms  │ 7.95 ms  │ 12.57 ms │ 2          │
│ Send       │ 0 ms     │ 0.12 ms  │ 2.75 ms  │ 43,556,439 │
│ Wait       │ 0.053 ms │ 0.39 ms  │ 23.33 ms │ 43,556,439 │
│ Receive    │ 0.008 ms │ 0.027 ms │ 4.08 ms  │ 43,556,439 │
│ Decompress │ 0 ms     │ 0 ms     │ 0 ms     │ 0          │
│ Total      │ 0.51 ms  │ 0.56 ms  │ 38.6 ms  │ 43,556,439 │
└────────────┴──────────┴──────────┴──────────┴────────────┘

Total time elapsed: 24 hours
Total requests sent: 43,556,440
Average performance: 500 req/sec
Peak performance: 501 req/sec

Number of warnings: 2
Number of errors: 0

[2017/10/13 13:10:43] Perf Warning: Req #1: HTTP 200 OK -- {"total":38.607,"send":0,"connect":12.576,"wait":23.336,"receive":1.733}
[2017/10/13 13:10:43] Perf Warning: Req #132: HTTP 200 OK -- {"total":13.967,"send":2.752,"wait":8.567,"receive":2.378}
````

# License

The MIT License (MIT)

Copyright (c) 2016 - 2017 Joseph Huckaby.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
