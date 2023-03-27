import asyncio
import base64
import collections
import json
import os
import sqlite3
import sys
import tempfile

import websockets

class ResponseError(RuntimeError):
    pass

async def main():
    server = await websockets.serve(handle_socket, "localhost", 2023, subprotocols=["hrana1"])
    for sock in server.sockets:
        print(f"Listening on {sock.getsockname()!r}")
    await server.wait_closed()

async def handle_socket(websocket):
    async def recv_msg():
        try:
            msg_str = await websocket.recv()
        except websockets.exceptions.ConnectionClosed:
            return None
        assert isinstance(msg_str, str)
        msg = json.loads(msg_str)
        return msg

    async def send_msg(msg):
        msg_str = json.dumps(msg)
        await websocket.send(msg_str)

    db_fd, db_file = tempfile.mkstemp(suffix=".db", prefix="hrana_client_test_")
    os.close(db_fd)
    print(f"Accepted connection from {websocket.remote_address}, using db {db_file!r}")

    Stream = collections.namedtuple("Stream", ["conn"])
    streams = {}

    async def handle_request(req):
        if req["type"] == "open_stream":
            conn = await asyncio.to_thread(lambda: sqlite3.connect(db_file,
                check_same_thread=False, isolation_level=None))
            streams[int(req["stream_id"])] = Stream(conn)
            return {"type": "open_stream"}
        elif req["type"] == "close_stream":
            stream = streams.pop(int(req["stream_id"]), None)
            if stream is not None:
                await asyncio.to_thread(lambda: stream.conn.close())
            return {"type": "close_stream"}
        elif req["type"] == "execute":
            stream = streams[int(req["stream_id"])]
            result = await asyncio.to_thread(lambda: execute_stmt(stream.conn, req["stmt"]))
            return {"type": "execute", "result": result}
        elif req["type"] == "batch":
            stream = streams[int(req["stream_id"])]
            result = await execute_batch(stream.conn, req["batch"])
            return {"type": "batch", "result": result}
        else:
            raise RuntimeError(f"Unknown req: {req!r}")

    def execute_stmt(conn, stmt):
        args = stmt.get("args", [])
        named_args = stmt.get("named_args", [])
        if len(named_args) == 0:
            sql_args = [value_to_sqlite(arg) for arg in args]
        elif len(args) == 0:
            sql_args = {}
            for arg in named_args:
                value = value_to_sqlite(arg["value"])
                if arg["name"][0] in (":", "@", "$"):
                    key = arg["name"][1:]
                else:
                    key = arg["name"]
                sql_args[key] = value
        else:
            raise RuntimeError(f"Using both positional and named arguments is not supported")

        try:
            cursor = conn.execute(stmt["sql"], sql_args)
        except sqlite3.OperationalError as e:
            raise ResponseError(str(e))
        cols = [{"name": name} for name, *_ in cursor.description or []]

        rows = []
        for row in cursor:
            if stmt["want_rows"]:
                rows.append([value_from_sqlite(val) for val in row])

        if cursor.rowcount >= 0:
            affected_row_count = cursor.rowcount
        else:
            affected_row_count = 0

        if cursor.lastrowid is not None:
            last_insert_rowid = str(cursor.lastrowid)
        else:
            last_insert_rowid = None

        return {
            "cols": cols,
            "rows": rows,
            "affected_row_count": affected_row_count,
            "last_insert_rowid": last_insert_rowid,
        }

    async def execute_batch(conn, batch):
        step_results = []
        step_errors = []
        for step in batch["steps"]:
            condition = step.get("condition")
            if condition is not None:
                enabled = eval_cond(step_results, step_errors, condition)
            else:
                enabled = True

            step_result = None
            step_error = None
            if enabled:
                try:
                    step_result = await asyncio.to_thread(lambda: execute_stmt(conn, step["stmt"]))
                except ResponseError as e:
                    step_error = {"message": str(e)}

            step_results.append(step_result)
            step_errors.append(step_error)

        return {
            "step_results": step_results,
            "step_errors": step_errors,
        }

    def eval_cond(step_results, step_errors, cond):
        if cond["type"] == "ok":
            return step_results[cond["step"]] is not None
        elif cond["type"] == "error":
            return step_errors[cond["step"]] is not None
        elif cond["type"] == "not":
            return not eval_cond(step_results, step_errors, cond["cond"])
        elif cond["type"] == "and":
            return all(eval_cond(step_results, step_errors, c) for c in cond["conds"])
        elif cond["type"] == "or":
            return any(eval_cond(step_results, step_errors, c) for c in cond["conds"])
        else:
            raise RuntimeError(f"Unknown cond: {cond!r}")

    def value_to_sqlite(value):
        if value["type"] == "null":
            return None
        elif value["type"] == "integer":
            return int(value["value"])
        elif value["type"] == "float":
            return float(value["value"])
        elif value["type"] == "text":
            return str(value["value"])
        elif value["type"] == "blob":
            return base64.b64decode(value["base64"])
        else:
            raise RuntimeError(f"Unknown value: {value!r}")

    def value_from_sqlite(value):
        if value is None:
            return {"type": "null"}
        elif isinstance(value, int):
            return {"type": "integer", "value": str(value)}
        elif isinstance(value, float):
            return {"type": "float", "value": value}
        elif isinstance(value, str):
            return {"type": "text", "value": value}
        elif isinstance(value, bytes):
            return {"type": "blob", "base64": base64.b64encode(value).decode()}
        else:
            raise RuntimeError(f"Unknown SQLite value: {value!r}")

    async def handle_msg(msg):
        if msg["type"] == "request":
            try:
                response = await handle_request(msg["request"])
                await send_msg({
                    "type": "response_ok",
                    "request_id": msg["request_id"],
                    "response": response,
                })
            except ResponseError as e:
                await send_msg({
                    "type": "response_error",
                    "request_id": msg["request_id"],
                    "error": {"message": str(e)},
                })
        else:
            raise RuntimeError(f"Unknown msg: {msg!r}")


    hello_msg = await recv_msg()
    assert hello_msg.get("type") == "hello"
    await send_msg({"type": "hello_ok"})

    try:
        while True:
            msg = await recv_msg()
            if msg is None:
                break
            await handle_msg(msg)
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        for stream in streams.values():
            stream.conn.close()
        os.unlink(db_file)

try:
    asyncio.run(main())
except KeyboardInterrupt:
    print()
