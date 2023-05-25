# Test servers for Hrana

This repository contains simple Hrana servers implemented in Python, one for each version of the Hrana protocol. These servers are useful for testing our various Hrana libraries.

By default, the server creates a single temporary database for all HTTP requests and a new temporary database for every WebSocket connection, so multiple streams in the same WebSocket connection share the database, but are isolated from other WebSocket connections. However, if you pass environment variable `PERSISTENT_DB`, all HTTP requests and WebSocket connections will use that as the database file.

If you pass any arguments to the server, they will be interpreted as a command. After the server starts up, it spawns the command, waits for it to terminate, and returns its exit code.
