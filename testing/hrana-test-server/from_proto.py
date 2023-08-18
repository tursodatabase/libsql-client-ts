import base64

def ws_client_msg(p):
    ty = p.WhichOneof("msg")
    if ty == "hello":
        return ws_hello_msg(p.hello)
    elif ty == "request":
        return ws_request_msg(p.request)
    else:
        raise RuntimeError("Unknown type of ClientMsg")

def ws_hello_msg(p):
    return {
        "type": "hello",
        "jwt": p.jwt if p.HasField("jwt") else None,
    }

def ws_request_msg(p):
    ty = p.WhichOneof("request")
    if ty == "open_stream":
        request = ws_open_stream_req(p.open_stream)
    elif ty == "close_stream":
        request = ws_close_stream_req(p.close_stream)
    elif ty == "execute":
        request = ws_execute_req(p.execute)
    elif ty == "batch":
        request = ws_batch_req(p.batch)
    elif ty == "open_cursor":
        request = ws_open_cursor_req(p.open_cursor)
    elif ty == "close_cursor":
        request = ws_close_cursor_req(p.close_cursor)
    elif ty == "fetch_cursor":
        request = ws_fetch_cursor_req(p.fetch_cursor)
    elif ty == "sequence":
        request = ws_sequence_req(p.sequence)
    elif ty == "describe":
        request = ws_describe_req(p.describe)
    elif ty == "store_sql":
        request = ws_store_sql_req(p.store_sql)
    elif ty == "close_sql":
        request = ws_close_sql_req(p.close_sql)
    elif ty == "get_autocommit":
        request = ws_get_autocommit_req(p.get_autocommit)
    else:
        raise RuntimeError("Unknown type of RequestMsg")
    return {"type": "request", "request_id": p.request_id, "request": request}

def ws_open_stream_req(p):
    return {"type": "open_stream", "stream_id": p.stream_id}

def ws_close_stream_req(p):
    return {"type": "close_stream", "stream_id": p.stream_id}

def ws_execute_req(p):
    return {
        "type": "execute",
        "stream_id": p.stream_id,
        "stmt": stmt(p.stmt),
    }

def ws_batch_req(p):
    return {
        "type": "batch",
        "stream_id": p.stream_id,
        "batch": batch(p.batch),
    }

def ws_open_cursor_req(p):
    return {
        "type": "open_cursor",
        "stream_id": p.stream_id,
        "cursor_id": p.cursor_id,
        "batch": batch(p.batch),
    }

def ws_close_cursor_req(p):
    return {
        "type": "close_cursor",
        "cursor_id": p.cursor_id,
    }

def ws_fetch_cursor_req(p):
    return {
        "type": "fetch_cursor",
        "cursor_id": p.cursor_id,
        "max_count": p.max_count,
    }

def ws_sequence_req(p):
    return {
        "type": "sequence",
        "stream_id": p.stream_id,
        "sql": p.sql if p.HasField("sql") else None,
        "sql_id": p.sql_id if p.HasField("sql_id") else None,
    }

def ws_describe_req(p):
    return {
        "type": "describe",
        "stream_id": p.stream_id,
        "sql": p.sql if p.HasField("sql") else None,
        "sql_id": p.sql_id if p.HasField("sql_id") else None,
    }

def ws_store_sql_req(p):
    return {
        "type": "store_sql",
        "sql_id": p.sql_id,
        "sql": p.sql,
    }

def ws_close_sql_req(p):
    return {
        "type": "close_sql",
        "sql_id": p.sql_id,
    }

def ws_get_autocommit_req(p):
    return {
        "type": "get_autocommit",
        "stream_id": p.stream_id,
    }



def http_pipeline_req_body(p):
    return {
        "baton": p.baton if p.HasField("baton") else None,
        "requests": [http_stream_request(p) for p in p.requests],
    }

def http_stream_request(p):
    ty = p.WhichOneof("request")
    if ty == "close":
        return {"type": "close"}
    if ty == "execute":
        return http_execute_stream_req(p.execute)
    elif ty == "batch":
        return http_batch_stream_req(p.batch)
    elif ty == "sequence":
        return http_sequence_stream_req(p.sequence)
    elif ty == "describe":
        return http_describe_stream_req(p.describe)
    elif ty == "store_sql":
        return http_store_sql_stream_req(p.store_sql)
    elif ty == "close_sql":
        return http_close_sql_stream_req(p.close_sql)
    elif ty == "get_autocommit":
        return {"type": "get_autocommit"}
    else:
        raise RuntimeError("Unknown type of StreamRequest")

def http_execute_stream_req(p):
    return {"type": "execute", "stmt": stmt(p.stmt)}

def http_batch_stream_req(p):
    return {"type": "batch", "batch": batch(p.batch)}

def http_sequence_stream_req(p):
    return {
        "type": "sequence",
        "sql": p.sql if p.HasField("sql") else None,
        "sql_id": p.sql_id if p.HasField("sql_id") else None,
    }

def http_describe_stream_req(p):
    return {
        "type": "describe",
        "sql": p.sql if p.HasField("sql") else None,
        "sql_id": p.sql_id if p.HasField("sql_id") else None,
    }

def http_store_sql_stream_req(p):
    return {"type": "store_sql", "sql_id": p.sql_id, "sql": p.sql}

def http_close_sql_stream_req(p):
    return {"type": "close_sql", "sql_id": p.sql_id}

def http_cursor_req_body(p):
    return {
        "baton": p.baton if p.HasField("baton") else None,
        "batch": batch(p.batch),
    }



def batch(p):
    return {"steps": [batch_step(p) for p in p.steps]}

def batch_step(p):
    return {
        "condition": batch_cond(p.condition) if p.HasField("condition") else None,
        "stmt": stmt(p.stmt),
    }

def batch_cond(p):
    ty = p.WhichOneof("cond")
    if ty == "step_ok":
        return {"type": "ok", "step": p.step_ok}
    elif ty == "step_error":
        return {"type": "error", "step": p.step_error}
    elif ty == "not":
        return {"type": "not", "cond": batch_cond(getattr(p, "not"))}
    elif ty == "and":
        return {"type": "and", "conds": [batch_cond(p) for p in getattr(p, "and").conds]}
    elif ty == "or":
        return {"type": "or", "conds": [batch_cond(p) for p in getattr(p, "or").conds]}
    elif ty == "is_autocommit":
        return {"type": "is_autocommit"}
    else:
        raise RuntimeError("Unknown type of BatchCond")

def stmt(p):
    return {
        "sql": p.sql if p.HasField("sql") else None,
        "sql_id": p.sql_id if p.HasField("sql_id") else None,
        "args": [value(p) for p in p.args],
        "named_args": [named_arg(p) for p in p.named_args],
        "want_rows": p.want_rows if p.HasField("want_rows") else None,
    }

def named_arg(p):
    return {
        "name": p.name,
        "value": value(p.value),
    }

def value(p):
    ty = p.WhichOneof("value")
    if ty == "null":
        return {"type": "null"}
    elif ty == "integer":
        return {"type": "integer", "value": str(p.integer)}
    elif ty == "float":
        return {"type": "float", "value": p.float}
    elif ty == "text":
        return {"type": "text", "value": p.text}
    elif ty == "blob":
        return {"type": "blob", "base64": base64.b64encode(p.blob)}
    else:
        raise RuntimeError("Unknown type of Value")
