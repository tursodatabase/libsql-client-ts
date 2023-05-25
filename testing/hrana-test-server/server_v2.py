import asyncio
import base64
import collections
import dataclasses
import json
import logging
import os
import random
import sys
import tempfile

import aiohttp.web

import c3

logger = logging.getLogger("server")
persistent_db_file = os.getenv("PERSISTENT_DB")

@dataclasses.dataclass
class HttpStream:
    conn: c3.Conn
    sqls: dict
    baton: str

async def main(command):
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

    app = aiohttp.web.Application()
    app.add_routes([
        aiohttp.web.get("/", handle_get_index),
        aiohttp.web.post("/v1/execute", handle_post_execute),
        aiohttp.web.post("/v1/batch", handle_post_batch),
        aiohttp.web.get("/v2", handle_get_index),
        aiohttp.web.post("/v2/pipeline", handle_post_pipeline),
    ])

    app["http_streams"] = {}

    if persistent_db_file is None:
        http_db_fd, http_db_file = tempfile.mkstemp(suffix=".db", prefix="hrana_test_")
        os.close(http_db_fd)
    else:
        http_db_file = persistent_db_file
    app["http_db_file"] = http_db_file
    app["db_sema"] = asyncio.BoundedSemaphore(8)

    async def on_shutdown(app):
        if http_db_file != persistent_db_file:
            os.unlink(http_db_file)
    app.on_shutdown.append(on_shutdown)

    runner = aiohttp.web.AppRunner(app)
    await runner.setup()
    site = aiohttp.web.TCPSite(runner, "localhost", 8080)
    await site.start()
    logger.info("Server is ready")

    if len(command) > 0:
        proc = await asyncio.create_subprocess_exec(*command)
        code = await proc.wait()
    else:
        while True:
            await asyncio.sleep(10)

    await runner.cleanup()
    return code

async def handle_get_index(req):
    ws = aiohttp.web.WebSocketResponse(protocols=("hrana2",))
    if ws.can_prepare(req):
        await ws.prepare(req)
        try:
            await handle_websocket(req.app, ws)
        finally:
            await ws.close()
        return ws

    return aiohttp.web.Response(text="This is a Hrana test server")

async def handle_websocket(app, ws):
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

    WsStream = collections.namedtuple("WsStream", ["conn"])
    streams = {}
    sqls = {}

    if persistent_db_file is None:
        db_fd, db_file = tempfile.mkstemp(suffix=".db", prefix="hrana_test_")
        os.close(db_fd)
    else:
        db_file = persistent_db_file

    async def handle_request(req):
        if req["type"] == "open_stream":
            conn = await to_thread(lambda: connect(db_file))
            stream_id = int(req["stream_id"])
            assert stream_id not in streams
            streams[stream_id] = WsStream(conn)
            return {"type": "open_stream"}
        elif req["type"] == "close_stream":
            stream = streams.pop(int(req["stream_id"]), None)
            if stream is not None:
                await to_thread(lambda: stream.conn.close())
            return {"type": "close_stream"}
        elif req["type"] == "execute":
            stream = streams[int(req["stream_id"])]
            async with app["db_sema"]:
                result = await to_thread(lambda: execute_stmt(stream.conn, sqls, req["stmt"]))
            return {"type": "execute", "result": result}
        elif req["type"] == "batch":
            stream = streams[int(req["stream_id"])]
            async with app["db_sema"]:
                result = await execute_batch(stream.conn, sqls, req["batch"])
            return {"type": "batch", "result": result}
        elif req["type"] == "sequence":
            stream = streams[int(req["stream_id"])]
            sql = get_sql(sqls, req)
            async with app["db_sema"]:
                await to_thread(lambda: execute_sequence(stream.conn, sql))
            return {"type": "sequence"}
        elif req["type"] == "describe":
            stream = streams[int(req["stream_id"])]
            sql = get_sql(sqls, req)
            async with app["db_sema"]:
                result = await to_thread(lambda: describe_stmt(stream.conn, sql))
            return {"type": "describe", "result": result}
        elif req["type"] == "store_sql":
            sql_id = int(req["sql_id"])
            assert sql_id not in sqls
            sqls[sql_id] = req["sql"]
            return {"type": "store_sql"}
        elif req["type"] == "close_sql":
            sqls.pop(int(req["sql_id"]))
            return {"type": "close_sql"}
        else:
            raise RuntimeError(f"Unknown req: {req!r}")

    hello_recvd = False

    async def handle_msg(msg):
        nonlocal hello_recvd
        if msg["type"] == "request":
            assert hello_recvd
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
                    "error": e.tojson(),
                })
        elif msg["type"] == "hello":
            jwt = msg.get("jwt")
            if jwt is not None:
                logger.info(f"Reauthenticated with JWT: {jwt[:20]}...")
            hello_recvd = True
            await send_msg({"type": "hello_ok"})
        else:
            raise RuntimeError(f"Unknown msg: {msg!r}")

    try:
        while True:
            msg = await recv_msg()
            if msg is None:
                break
            await handle_msg(msg)
    except CloseWebSocket:
        await ws.close()
    except CloseTcpSocket:
        ws._writer.transport.close()
    finally:
        for stream in streams.values():
            stream.conn.close()
        if db_file != persistent_db_file:
            os.unlink(db_file)

async def handle_post_execute(req):
    req_body = await req.json()
    conn = await to_thread(lambda: connect(req.app["http_db_file"]))
    try:
        async with req.app["db_sema"]:
            result = await to_thread(lambda: execute_stmt(conn, {}, req_body["stmt"]))
        return aiohttp.web.json_response({"result": result})
    except ResponseError as e:
        return aiohttp.web.json_response(e.tojson(), status=400)
    finally:
        conn.close()

async def handle_post_batch(req):
    req_body = await req.json()
    conn = await to_thread(lambda: connect(req.app["http_db_file"]))
    try:
        async with req.app["db_sema"]:
            result = await execute_batch(conn, {}, req_body["batch"])
        return aiohttp.web.json_response({"result": result})
    except ResponseError as e:
        return aiohttp.web.json_response(e.tojson(), status=400)
    finally:
        conn.close()

async def handle_post_pipeline(req):
    req_body = await req.json()
    app = req.app

    if req_body.get("baton") is not None:
        baton = req_body["baton"]
        stream_id, _, _ = baton.partition(".")
        stream = req.app["http_streams"][stream_id]
        assert stream.baton == baton
    else:
        conn = await to_thread(lambda: connect(req.app["http_db_file"]))
        stream_id = random.randbytes(16).hex()
        stream = HttpStream(conn, sqls={}, baton=None)
        req.app["http_streams"][stream_id] = stream
    stream.baton = f"{stream_id}.{random.randbytes(8).hex()}"

    async def handle_request(req):
        if req["type"] == "execute":
            async with app["db_sema"]:
                result = await to_thread(lambda: execute_stmt(stream.conn, stream.sqls, req["stmt"]))
            return {"type": "execute", "result": result}
        elif req["type"] == "batch":
            async with app["db_sema"]:
                result = await execute_batch(stream.conn, stream.sqls, req["batch"])
            return {"type": "batch", "result": result}
        elif req["type"] == "sequence":
            sql = get_sql(stream.sqls, req)
            async with app["db_sema"]:
                await to_thread(lambda: execute_sequence(stream.conn, sql))
            return {"type": "sequence"}
        elif req["type"] == "describe":
            sql = get_sql(stream.sqls, req)
            async with app["db_sema"]:
                result = await to_thread(lambda: describe_stmt(stream.conn, sql))
            return {"type": "describe", "result": result}
        elif req["type"] == "store_sql":
            sql_id = int(req["sql_id"])
            assert sql_id not in stream.sqls
            stream.sqls[sql_id] = req["sql"]
            return {"type": "store_sql"}
        elif req["type"] == "close_sql":
            stream.sqls.pop(int(req["sql_id"]))
            return {"type": "close_sql"}
        elif req["type"] == "close":
            stream.conn.close()
            stream.conn = None
        else:
            raise RuntimeError(f"Unknown req: {req!r}")

    try:
        results = []
        for request in req_body["requests"]:
            try:
                response = await handle_request(request)
                result = {"type": "ok", "response": response}
            except ResponseError as e:
                result = {"type": "error", "error": e.tojson()}
            results.append(result)
    except Exception:
        if stream.conn is not None:
            stream.conn.close()
        stream.conn = None
        raise
    finally:
        if stream.conn is None:
            stream.baton = None
            del app["http_streams"][stream_id]

    return aiohttp.web.json_response({
        "baton": stream.baton,
        "results": results,
    })

def connect(db_file):
    conn = c3.Conn.open(db_file)
    conn.extended_result_codes(True)
    conn.limit(c3.SQLITE_LIMIT_ATTACHED, 0)
    conn.busy_timeout(1000)
    conn.exec("PRAGMA journal_mode = WAL")
    return conn

def get_sql(sqls, obj):
    sql, sql_id = obj.get("sql"), obj.get("sql_id")
    assert sql is None or sql_id is None
    if sql is not None:
        return sql
    elif sql_id is not None:
        return sqls[sql_id]
    else:
        raise RuntimeError("Expected 'sql' or 'sql_id'")

class CloseWebSocket(BaseException):
    pass

class CloseTcpSocket(BaseException):
    pass

def execute_stmt(conn, sqls, stmt):
    sql = get_sql(sqls, stmt)

    if sql == ".close_ws":
        raise CloseWebSocket()
    elif sql == ".close_tcp":
        raise CloseTcpSocket()

    try:
        changes_before = conn.total_changes()
        prepared, sql_rest = conn.prepare(sql)
        if not prepared:
            raise ResponseError(f"SQL string does not contain a valid statement", "SQL_NO_STATEMENT")

        param_count = prepared.param_count()

        if len(sql_rest.strip()) != 0:
            raise ResponseError(f"SQL string contains more than one statement")

        args = stmt.get("args", [])
        named_args = stmt.get("named_args", [])
        provided_params_count = len(args) + len(named_args)
        if provided_params_count != param_count:
            raise ResponseError(f"Required {param_count} but {provided_params_count} were provided", "ARGS_INVALID")

        for param_i, arg_value in enumerate(args, 1):
            prepared.bind(param_i, value_to_sqlite(arg_value))

        for arg in named_args:
            arg_name = arg["name"]
            if arg_name[0] in (":", "@", "$"):
                param_i = prepared.param_index(arg_name)
            else:
                for prefix in (":", "@", "$"):
                    param_i = prepared.param_index(prefix + arg_name)
                    if param_i != 0: break

            if param_i == 0:
                raise ResponseError(f"Parameter with name {arg_name!r} was not found", "ARGS_INVALID")
            prepared.bind(param_i, value_to_sqlite(arg["value"]))

        col_count = prepared.column_count()
        cols = [
            {
                "name": prepared.column_name(col_i),
                "decltype": prepared.column_decltype(col_i),
            }
            for col_i in range(col_count)
        ]

        want_rows = stmt.get("want_rows", True)
        rows = []
        while prepared.step():
            if not want_rows:
                continue

            cells = []
            for col_i in range(col_count):
                try:
                    val = prepared.column(col_i)
                except ValueError as e:
                    name = cols[col_i].get("name") or col_i
                    if isinstance(e, UnicodeDecodeError):
                        # NOTE: formatting msg like this to match Python's dbapi
                        # error, but it could be anything. However this way
                        # allows the hrana test server to be used against
                        # Python's test suite
                        obj = e.object.decode(errors="replace")
                        msg = f"Could not decode to UTF-8 column {name!r} with text {obj!r}"
                        code = "UNICODE_ERROR"
                    else:
                        msg = f"Could not get column {name!r}: {e}"
                        code = "VALUE_ERROR"
                    raise ResponseError(msg, code) from e

                cells.append(value_from_sqlite(val))

            rows.append(cells)

        affected_row_count = conn.total_changes() - changes_before
        last_insert_rowid = conn.last_insert_rowid()
    except c3.SqliteError as e:
        raise ResponseError(e) from e

    return {
        "cols": cols,
        "rows": rows,
        "affected_row_count": affected_row_count,
        "last_insert_rowid": str(last_insert_rowid),
    }

def describe_stmt(conn, sql):
    try:
        prepared, _ = conn.prepare(sql)

        param_count = prepared.param_count()
        params = [
            {"name": prepared.param_name(param_i)}
            for param_i in range(1, param_count+1)
        ]

        col_count = prepared.column_count()
        cols = [
            {
                "name": prepared.column_name(col_i),
                "decltype": prepared.column_decltype(col_i)
            }
            for col_i in range(col_count)
        ]

        is_explain = prepared.isexplain() > 0
        is_readonly = prepared.readonly()
    except c3.SqliteError as e:
        raise ResponseError(e) from e

    return {
        "params": params,
        "cols": cols,
        "is_explain": is_explain,
        "is_readonly": is_readonly,
    }

def execute_sequence(conn, sql):
    try:
        while len(sql) > 0:
            prepared, sql = conn.prepare(sql)
            if prepared is None:
                break
            while prepared.step():
                pass
    except c3.SqliteError as e:
        raise ResponseError(e) from e

async def execute_batch(conn, sqls, batch):
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
                step_result = await to_thread(lambda: execute_stmt(conn, sqls, step["stmt"]))
            except ResponseError as e:
                step_error = e.tojson()

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
    def __init__(self, message, code=None):
        if isinstance(message, c3.SqliteError):
            if code is None:
                code = message.error_name
            message = str(message)
        super().__init__(message)
        self.code = code

    def tojson(self):
        message = str(self)
        if self.code:
            return {"message": message, "code": self.code}
        return {"message": message}


async def to_thread(func):
    return await asyncio.get_running_loop().run_in_executor(None, func)

if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main(sys.argv[1:])))
    except KeyboardInterrupt:
        print()
