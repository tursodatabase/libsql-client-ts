# Test server for Hrana

This is a simple Hrana server implemented in Python, which is useful for testing our various Hrana libraries. It creates a new temporary database for each WebSocket connection, but uses a single global temporary database for HTTP requests.

If you pass any arguments to the server, they will be interpreted as a command. After the server starts up, it spawns the command, waits for it to terminate, and returns its exit code.
