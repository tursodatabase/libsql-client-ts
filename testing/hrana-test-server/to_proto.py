import base64

import proto.hrana.ws_pb2

def ws_server_msg(p, m):
    if m["type"] == "hello_ok":
        p.hello_ok.SetInParent()
    elif m["type"] == "hello_error":
        error(p.hello_error.error, m["error"])
    elif m["type"] == "response_ok":
        p.response_ok.request_id = m["request_id"]
        if m["response"]["type"] == "open_stream":
            p.response_ok.open_stream.SetInParent()
        elif m["response"]["type"] == "close_stream":
            p.response_ok.close_stream.SetInParent()
        elif m["response"]["type"] == "execute":
            ws_execute_resp(p.response_ok.execute, m["response"])
        elif m["response"]["type"] == "batch":
            ws_batch_resp(p.response_ok.batch, m["response"])
        elif m["response"]["type"] == "open_cursor":
            p.response_ok.open_cursor.SetInParent()
        elif m["response"]["type"] == "close_cursor":
            p.response_ok.close_cursor.SetInParent()
        elif m["response"]["type"] == "fetch_cursor":
            ws_fetch_cursor_resp(p.response_ok.fetch_cursor, m["response"])
        elif m["response"]["type"] == "sequence":
            p.response_ok.sequence.SetInParent()
        elif m["response"]["type"] == "describe":
            ws_describe_resp(p.response_ok.describe, m["response"])
        elif m["response"]["type"] == "store_sql":
            p.response_ok.store_sql.SetInParent()
        elif m["response"]["type"] == "close_sql":
            p.response_ok.close_sql.SetInParent()
        elif m["response"]["type"] == "get_autocommit":
            ws_get_autocommit_resp(p.response_ok.get_autocommit, m["response"])
    elif m["type"] == "response_error":
        p.response_error.request_id = m["request_id"]
        error(p.response_error.error, m["error"])

def ws_execute_resp(p, m):
    stmt_result(p.result, m["result"])

def ws_batch_resp(p, m):
    batch_result(p.result, m["result"])

def ws_fetch_cursor_resp(p, m):
    for mm in m["entries"]:
        cursor_entry(p.entries.add(), mm)
    p.done = m["done"]

def ws_describe_resp(p, m):
    describe_result(p.result, m["result"])

def ws_get_autocommit_resp(p, m):
    p.is_autocommit = m["is_autocommit"]



def http_pipeline_resp_body(p, m):
    if m["baton"] is not None:
        p.baton = m["baton"]
    if m.get("base_url") is not None:
        p.base_url = m["base_url"]
    for mm in m["results"]:
        http_stream_result(p.results.add(), mm)

def http_stream_result(p, m):
    if m["type"] == "ok":
        http_stream_response(p.ok, m["response"])
    elif m["type"] == "error":
        error(p.error, m["error"])

def http_stream_response(p, m):
    if m["type"] == "close":
        p.close.SetInParent()
    elif m["type"] == "execute":
        stmt_result(p.execute.result, m["result"])
    elif m["type"] == "batch":
        batch_result(p.batch.result, m["result"])
    elif m["type"] == "sequence":
        p.sequence.SetInParent()
    elif m["type"] == "describe":
        describe_result(p.describe.result, m["result"])
    elif m["type"] == "store_sql":
        p.store_sql.SetInParent()
    elif m["type"] == "close_sql":
        p.close_sql.SetInParent()
    elif m["type"] == "get_autocommit":
        p.get_autocommit.is_autocommit = m["is_autocommit"]

def http_cursor_resp_body(p, m):
    if m["baton"] is not None:
        p.baton = m["baton"]
    if m.get("base_url") is not None:
        p.base_url = m["base_url"]



def error(p, m):
    p.message = m["message"]
    if m["code"] is not None:
        p.code = m["code"]

def cursor_entry(p, m):
    if m["type"] == "step_begin":
        p.step_begin.step = m["step"]
        for mm in m["cols"]:
            col(p.step_begin.cols.add(), mm)
    elif m["type"] == "step_end":
        p.step_end.affected_row_count = m["affected_row_count"]
        if m["last_insert_rowid"] is not None:
            p.step_end.last_insert_rowid = int(m["last_insert_rowid"])
    elif m["type"] == "step_error":
        p.step_error.step = m["step"]
        error(p.step_error.error, m["error"])
    elif m["type"] == "row":
        row(p.row, m["row"])
    elif m["type"] == "error":
        error(p.error, m["error"])
    return p

def stmt_result(p, m):
    for mm in m["cols"]:
        col(p.cols.add(), mm)
    for mm in m["rows"]:
        row(p.rows.add(), mm)
    p.affected_row_count = m["affected_row_count"]
    if m["last_insert_rowid"] is not None:
        p.last_insert_rowid = int(m["last_insert_rowid"])

def col(p, m):
    p.name = m["name"]
    if m["decltype"] is not None:
        p.decltype = m["decltype"]

def row(p, m):
    for mm in m:
        value(p.values.add(), mm)

def batch_result(p, m):
    p.SetInParent()
    for i, mm in enumerate(m["step_results"]):
        if mm is not None:
            stmt_result(p.step_results[i], mm)
    for i, mm in enumerate(m["step_errors"]):
        if mm is not None:
            error(p.step_errors[i], mm)

def describe_result(p, m):
    for mm in m["params"]:
        describe_param(p.params.add(), mm)
    for mm in m["cols"]:
        describe_col(p.cols.add(), mm)
    p.is_explain = m["is_explain"]
    p.is_readonly = m["is_readonly"]

def describe_param(p, m):
    if m["name"] is not None:
        p.name = m["name"]

def describe_col(p, m):
    p.name = m["name"]
    if m["decltype"] is not None:
        p.decltype = m["decltype"]

def value(p, m):
    if m["type"] == "null":
        p.null.SetInParent()
    elif m["type"] == "integer":
        p.integer = int(m["value"])
    elif m["type"] == "float":
        p.float = m["value"]
    elif m["type"] == "text":
        p.text = m["value"]
    elif m["type"] == "blob":
        p.blob = base64.b64decode(m["base64"])
