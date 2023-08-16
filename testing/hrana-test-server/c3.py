import logging
import platform
from ctypes import (
    CDLL, POINTER, CFUNCTYPE,
    pointer, byref, string_at, cast,
    c_void_p, c_char_p,
    c_int, c_int64, c_uint64, c_double, c_char,
)

from sqlite3_error_map import sqlite_error_code_to_name

logger = logging.getLogger("server")

c_sqlite3_p = c_void_p
c_sqlite3_stmt_p = c_void_p
c_exec_callback_fn = CFUNCTYPE(c_int, c_void_p, c_int, POINTER(c_char_p), POINTER(c_char_p))
c_destructor_fn = CFUNCTYPE(None, c_void_p)

libfile_platform = {
    "Linux": "libsqlite3.so",
    "Darwin": "libsqlite3.dylib",
}

platform_name = platform.system()
libfile = libfile_platform[platform_name]
lib = CDLL(libfile)
lib.sqlite3_open_v2.argtypes = (c_char_p, POINTER(c_sqlite3_p), c_int, c_char_p,)
lib.sqlite3_open_v2.restype = c_int
lib.sqlite3_close_v2.argtypes = (c_sqlite3_p,)
lib.sqlite3_close_v2.restype = c_int
lib.sqlite3_extended_result_codes.argtypes = (c_sqlite3_p, c_int,)
lib.sqlite3_extended_result_codes.restype = c_int
lib.sqlite3_errmsg.argtypes = (c_sqlite3_p,)
lib.sqlite3_errmsg.restype = c_char_p
lib.sqlite3_errstr.argtypes = (c_int,)
lib.sqlite3_errstr.restype = c_char_p
lib.sqlite3_exec.argtypes = (c_sqlite3_p, c_char_p, c_exec_callback_fn, c_void_p, POINTER(c_char_p),)
lib.sqlite3_exec.restype = c_int
lib.sqlite3_txn_state.argtypes = (c_sqlite3_p, c_char_p,)
lib.sqlite3_txn_state.restype = c_int
lib.sqlite3_changes64.argtypes = (c_sqlite3_p,)
lib.sqlite3_changes64.restype = c_int64
lib.sqlite3_total_changes64.argtypes = (c_sqlite3_p,)
lib.sqlite3_total_changes64.restype = c_int64
lib.sqlite3_last_insert_rowid.argtypes = (c_sqlite3_p,)
lib.sqlite3_last_insert_rowid.restype = c_int64
lib.sqlite3_limit.argtypes = (c_sqlite3_p, c_int, c_int,)
lib.sqlite3_limit.restype = c_int
lib.sqlite3_busy_timeout.argtypes = (c_sqlite3_p, c_int,)
lib.sqlite3_busy_timeout.restype = c_int
lib.sqlite3_get_autocommit.argtypes = (c_sqlite3_p,)
lib.sqlite3_get_autocommit.restype = c_int

lib.sqlite3_prepare_v2.argtypes = (
    c_sqlite3_p, c_void_p, c_int, POINTER(c_sqlite3_stmt_p), POINTER(c_void_p),)
lib.sqlite3_prepare_v2.restype = c_int
lib.sqlite3_finalize.argtypes = (c_sqlite3_stmt_p,)
lib.sqlite3_finalize.restype = c_int
lib.sqlite3_step.argtypes = (c_sqlite3_stmt_p,)
lib.sqlite3_step.restype = c_int
lib.sqlite3_bind_parameter_count.argtypes = (c_sqlite3_stmt_p,)
lib.sqlite3_bind_parameter_count.restype = c_int
lib.sqlite3_bind_parameter_index.argtypes = (c_sqlite3_stmt_p, c_char_p,)
lib.sqlite3_bind_parameter_index.restype = c_int
lib.sqlite3_bind_parameter_name.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_bind_parameter_name.restype = c_char_p
lib.sqlite3_bind_blob64.argtypes = (c_sqlite3_stmt_p, c_int, c_void_p, c_uint64, c_destructor_fn,)
lib.sqlite3_bind_blob64.restype = c_int
lib.sqlite3_bind_text.argtypes = (c_sqlite3_stmt_p, c_int, POINTER(c_char), c_int, c_destructor_fn,)
lib.sqlite3_bind_text.restype = c_int
lib.sqlite3_bind_double.argtypes = (c_sqlite3_stmt_p, c_int, c_double,)
lib.sqlite3_bind_double.restype = c_int
lib.sqlite3_bind_int64.argtypes = (c_sqlite3_stmt_p, c_int, c_int64,)
lib.sqlite3_bind_int64.restype = c_int
lib.sqlite3_bind_null.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_bind_null.restype = c_int
lib.sqlite3_column_count.argtypes = (c_sqlite3_stmt_p,)
lib.sqlite3_column_count.restype = c_int
lib.sqlite3_column_name.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_name.restype = c_char_p
lib.sqlite3_column_decltype.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_decltype.restype = c_char_p
lib.sqlite3_column_type.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_type.restype = c_int
lib.sqlite3_column_blob.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_blob.restype = c_void_p
lib.sqlite3_column_text.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_text.restype = c_void_p
lib.sqlite3_column_bytes.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_bytes.restype = c_int
lib.sqlite3_column_double.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_double.restype = c_double
lib.sqlite3_column_int64.argtypes = (c_sqlite3_stmt_p, c_int,)
lib.sqlite3_column_int64.restype = c_int64
lib.sqlite3_stmt_readonly.argtypes = (c_sqlite3_stmt_p,)
lib.sqlite3_stmt_readonly.restype = c_int
lib.sqlite3_stmt_isexplain.argtypes = (c_sqlite3_stmt_p,)
lib.sqlite3_stmt_isexplain.restype = c_int

SQLITE_OPEN_READWRITE = 0x00000002
SQLITE_OPEN_CREATE = 0x00000004
SQLITE_TRANSIENT = c_destructor_fn(-1)
SQLITE_ROW = 100
SQLITE_DONE = 101

SQLITE_INTEGER = 1
SQLITE_FLOAT = 2
SQLITE_BLOB = 4
SQLITE_NULL = 5
SQLITE_TEXT = 3

SQLITE_LIMIT_LENGTH = 0
SQLITE_LIMIT_SQL_LENGTH = 1
SQLITE_LIMIT_COLUMN = 2
SQLITE_LIMIT_EXPR_DEPTH = 3
SQLITE_LIMIT_COMPOUND_SELECT = 4
SQLITE_LIMIT_VDBE_OP = 5
SQLITE_LIMIT_FUNCTION_ARG = 6
SQLITE_LIMIT_ATTACHED = 7
SQLITE_LIMIT_LIKE_PATTERN_LENGTH = 8
SQLITE_LIMIT_VARIABLE_NUMBER = 9
SQLITE_LIMIT_TRIGGER_DEPTH = 10
SQLITE_LIMIT_WORKER_THREADS = 11


class Conn:
    def __init__(self, db_ptr):
        self.db_ptr = db_ptr

    @classmethod
    def open(cls, filename):
        filename_ptr = c_char_p(filename.encode())
        db_ptr = c_sqlite3_p()
        flags = SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE
        vfs_ptr = c_char_p()
        _try(lib.sqlite3_open_v2(filename_ptr, byref(db_ptr), flags, vfs_ptr))
        return cls(db_ptr)

    def close(self):
        if self.db_ptr is not None:
            lib.sqlite3_close_v2(self.db_ptr)
            self.db_ptr = None

    def __del__(self):
        self.close()

    def extended_result_codes(self, onoff):
        assert self.db_ptr is not None
        lib.sqlite3_extended_result_codes(self.db_ptr, onoff)

    def errmsg(self):
        assert self.db_ptr is not None
        return str(lib.sqlite3_errmsg(self.db_ptr).decode())

    @classmethod
    def errstr(cls, code):
        return str(lib.sqlite3_errstr(code).decode())

    def exec(self, sql):
        assert self.db_ptr is not None
        sql_ptr = c_char_p(sql.encode())
        callback_ptr = c_exec_callback_fn()
        arg_ptr = c_void_p()
        errmsg_ptr_ptr = pointer(c_char_p())
        _try(lib.sqlite3_exec(self.db_ptr, sql_ptr, callback_ptr, arg_ptr, errmsg_ptr_ptr), self)

    def txn_state(self):
        assert self.db_ptr is not None
        schema_ptr = c_char_p()
        return lib.sqlite3_txn_state(self.db_ptr, schema_ptr)

    def prepare(self, sql):
        assert self.db_ptr is not None
        sql = sql.encode()
        sql_data = c_char_p(sql)
        sql_ptr = cast(sql_data, c_void_p)
        sql_len = c_int(len(sql) + 1)
        stmt_ptr = c_sqlite3_stmt_p()
        tail_ptr = c_void_p()
        _try(lib.sqlite3_prepare_v2(self.db_ptr, sql_ptr, sql_len, byref(stmt_ptr), byref(tail_ptr)), self)
        if stmt_ptr.value is None:
            return None, b""
        tail = sql[tail_ptr.value - sql_ptr.value:]
        return Stmt(self, stmt_ptr), tail.decode()

    def changes(self):
        assert self.db_ptr is not None
        return lib.sqlite3_changes64(self.db_ptr)

    def total_changes(self):
        assert self.db_ptr is not None
        return lib.sqlite3_total_changes64(self.db_ptr)

    def last_insert_rowid(self):
        assert self.db_ptr is not None
        return lib.sqlite3_last_insert_rowid(self.db_ptr)

    def limit(self, id, new_val):
        assert self.db_ptr is not None
        return lib.sqlite3_limit(self.db_ptr, id, new_val)

    def busy_timeout(self, ms):
        assert self.db_ptr is not None
        lib.sqlite3_busy_timeout(self.db_ptr, ms)

    def get_autocommit(self):
        assert self.db_ptr is not None
        return lib.sqlite3_get_autocommit(self.db_ptr) != 0

class Stmt:
    def __init__(self, conn, stmt_ptr):
        self.conn = conn
        self.stmt_ptr = stmt_ptr

    def close(self):
        if self.stmt_ptr is not None:
            lib.sqlite3_finalize(self.stmt_ptr)
            self.stmt_ptr = None

    def __del__(self):
        self.close()

    def param_count(self):
        assert self.stmt_ptr is not None
        return lib.sqlite3_bind_parameter_count(self.stmt_ptr)

    def param_index(self, name):
        assert self.stmt_ptr is not None
        name_ptr = c_char_p(name.encode())
        return lib.sqlite3_bind_parameter_index(self.stmt_ptr, name_ptr)

    def param_name(self, param_i):
        assert self.stmt_ptr is not None
        name = lib.sqlite3_bind_parameter_name(self.stmt_ptr, param_i)
        return name.decode() if name is not None else None

    def bind(self, param_i, value):
        assert self.stmt_ptr is not None
        if isinstance(value, str):
            value = value.encode()
            value_ptr, value_len = c_char_p(value), c_int(len(value))
            _try(lib.sqlite3_bind_text(self.stmt_ptr, param_i, value_ptr, value_len, SQLITE_TRANSIENT), self.conn)
        elif isinstance(value, bytes):
            value_ptr, value_len = c_char_p(value), c_uint64(len(value))
            _try(lib.sqlite3_bind_blob64(self.stmt_ptr, param_i, value_ptr, value_len, SQLITE_TRANSIENT), self.conn)
        elif isinstance(value, int):
            _try(lib.sqlite3_bind_int64(self.stmt_ptr, param_i, c_int64(value)), self.conn)
        elif isinstance(value, float):
            _try(lib.sqlite3_bind_double(self.stmt_ptr, param_i, c_double(value)), self.conn)
        elif value is None:
            _try(lib.sqlite3_bind_null(self.stmt_ptr, param_i), self.conn)
        else:
            raise ValueError(f"Cannot bind {type(value)!r}")

    def step(self):
        assert self.stmt_ptr is not None
        res = lib.sqlite3_step(self.stmt_ptr)
        if res == SQLITE_DONE:
            return False
        elif res == SQLITE_ROW:
            return True
        _try(res, self.conn)

    def column_count(self):
        assert self.stmt_ptr is not None
        return lib.sqlite3_column_count(self.stmt_ptr)

    def column_name(self, column_i):
        assert self.stmt_ptr is not None
        return lib.sqlite3_column_name(self.stmt_ptr, column_i).decode()

    def column_decltype(self, column_i):
        assert self.stmt_ptr is not None
        name = lib.sqlite3_column_decltype(self.stmt_ptr, column_i)
        return name.decode() if name is not None else name

    def column(self, column_i):
        assert self.stmt_ptr is not None
        typ = lib.sqlite3_column_type(self.stmt_ptr, column_i)
        if typ == SQLITE_INTEGER:
            return lib.sqlite3_column_int64(self.stmt_ptr, column_i)
        elif typ == SQLITE_FLOAT:
            return lib.sqlite3_column_double(self.stmt_ptr, column_i)
        elif typ == SQLITE_BLOB:
            data_ptr = lib.sqlite3_column_blob(self.stmt_ptr, column_i)
            data_len = lib.sqlite3_column_bytes(self.stmt_ptr, column_i)
            return bytes(string_at(data_ptr, data_len))
        elif typ == SQLITE_TEXT:
            data_ptr = lib.sqlite3_column_text(self.stmt_ptr, column_i)
            data_len = lib.sqlite3_column_bytes(self.stmt_ptr, column_i)
            b = bytes(string_at(data_ptr, data_len))
            try:
                return b.decode()
            except UnicodeDecodeError:
                logger.debug("Could not decode column %s, bytes %s", column_i, b, exc_info=True)
                raise
        elif typ == SQLITE_NULL:
            return None
        else:
            raise ValueError(f"Unknown SQLite type {typ}")

    def readonly(self):
        assert self.stmt_ptr is not None
        return lib.sqlite3_stmt_readonly(self.stmt_ptr) != 0

    def isexplain(self):
        assert self.stmt_ptr is not None
        return lib.sqlite3_stmt_isexplain(self.stmt_ptr)


class SqliteError(RuntimeError):
    def __init__(self, message, error_code=None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.error_name = sqlite_error_code_to_name.get(error_code)


def _try(error_code, conn=None):
    if error_code == 0:
        return

    error_str = Conn.errstr(error_code)
    if conn is not None:
        details = f": {conn.errmsg()}"

    message = f"SQLite function returned error code {error_code} ({error_str}){details}"
    raise SqliteError(message, error_code)
