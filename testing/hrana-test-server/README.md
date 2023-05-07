# Test servers for Hrana

This repository contains simple Hrana servers implemented in Python, one for each version of the Hrana protocol. These servers are useful for testing our various Hrana libraries. The servers create a new temporary database for each WebSocket connection, but use a single global temporary database for HTTP requests.

If you pass any arguments to the server, they will be interpreted as a command. After the server starts up, it spawns the command, waits for it to terminate, and returns its exit code.
