import asyncio
import base64
import collections
import json
import logging
import os
import sqlite3
import sys
import tempfile

import aiohttp.web

logger = logging.getLogger("test_server")

async def main(command):
    logging.basicConfig(level=logging.INFO)

    app = aiohttp.web.Application()
    app.add_routes([
        aiohttp.web.get("/", handle_get_index),
        aiohttp.web.post("/v1/execute", handle_post_execute),
        aiohttp.web.post("/v1/batch", handle_post_batch),
    ])

    http_db_fd, http_db_file = tempfile.mkstemp(suffix=".db", prefix="hrana_test_http_")
    os.close(http_db_fd)
    app["http_db_conn"] = connect(http_db_file)
    app["http_db_lock"] = asyncio.Lock()
    logger.info(f"Using db {http_db_file!r} for HTTP requests")

    async def on_shutdown(app):
        app["http_db_conn"].close()
        os.unlink(http_db_file)
    app.on_shutdown.append(on_shutdown)

    runner = aiohttp.web.AppRunner(app)
    await runner.setup()
    site = aiohttp.web.TCPSite(runner, "localhost", 8080)
    await site.start()

    if len(command) > 0:
        proc = await asyncio.create_subprocess_exec(*command)
        code = await proc.wait()
    else:
        while True:
            await asyncio.sleep(10)

    await runner.cleanup()
    return code

async def handle_get_index(req):
    ws = aiohttp.web.WebSocketResponse(protocols=("hrana1",))
    if ws.can_prepare(req):
        await ws.prepare(req)
        await handle_websocket(ws)
        return ws

    return aiohttp.web.Response(text="This is a Hrana test server")

async def handle_websocket(ws):
    async def recv_msg():
        ws_msg = await ws.receive()
        if ws_msg.type == aiohttp.WSMsgType.TEXT:
            msg = json.loads(ws_msg.data)
            return msg
        elif ws_msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED):
            return None
        else:
            raise RuntimeError(f"Unknown websocket message: {msg!r}")

    async def send_msg(msg):
        msg_str = json.dumps(msg)
        await ws.send_str(msg_str)

    db_fd, db_file = tempfile.mkstemp(suffix=".db", prefix="hrana_test_ws_")
    os.close(db_fd)
    logger.info(f"Accepted WebSocket using db {db_file!r}")

    Stream = collections.namedtuple("Stream", ["conn"])
    streams = {}

    async def handle_request(req):
        if req["type"] == "open_stream":
            conn = await asyncio.to_thread(lambda: connect(db_file))
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
    finally:
        for stream in streams.values():
            stream.conn.close()
        os.unlink(db_file)

async def handle_post_execute(req):
    req_body = await req.json()
    async with req.app["http_db_lock"]:
        conn = req.app["http_db_conn"]
        try:
            result = await asyncio.to_thread(lambda: execute_stmt(conn, req_body["stmt"]))
            return aiohttp.web.json_response({"result": result})
        except ResponseError as e:
            return aiohttp.web.json_response({"message": str(e)}, status=400)
        finally:
            cleanup_conn(conn)

async def handle_post_batch(req):
    req_body = await req.json()
    async with req.app["http_db_lock"]:
        conn = req.app["http_db_conn"]
        try:
            result = await execute_batch(conn, req_body["batch"])
            return aiohttp.web.json_response({"result": result})
        except ResponseError as e:
            return aiohttp.web.json_response({"message": str(e)}, status=400)
        finally:
            cleanup_conn(conn)

def connect(db_file):
    conn = sqlite3.connect(db_file, check_same_thread=False, isolation_level=None, timeout=0)
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def cleanup_conn(conn):
    if conn.in_transaction:
        conn.execute("ROLLBACK")

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

class ResponseError(RuntimeError):
    pass

if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main(sys.argv[1:])))
    except KeyboardInterrupt:
        print()
