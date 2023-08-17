#!/bin/sh
cd $(dirname "$0")
protoc -I. *.proto --python_out=. --experimental_allow_proto3_optional
sed -i 's/^import hrana_pb2 /from .. import hrana_pb2 /' hrana/*_pb2.py
