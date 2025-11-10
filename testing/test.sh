#!/bin/sh

python3 -m venv .venv
source .venv/bin/activate
pip3 install aiohttp protobuf

npm run build && SERVER=test_v2 python3 testing/hrana-test-server/server_v2.py npm test --prefix packages/libsql-client
