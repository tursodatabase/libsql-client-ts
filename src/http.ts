import * as hrana from "@libsql/hrana-client";
import { fetch } from "cross-fetch";

import type { Config, Client } from "./api.js";
import { InStatement, ResultSet, LibsqlError } from "./api.js";
import { expandConfig } from "./config.js";
import { stmtToHrana, resultSetFromHrana, mapHranaError } from "./hrana.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    const expandedConfig = expandConfig(config);
    const url = expandedConfig.url;
    if (expandedConfig.transactions) {
        throw new LibsqlError(
            "The HTTP client does not support transactions. " +
            "Please use a libsql:// or libsqls:// URL to allow the client to connect using a WebSocket.",
            "TRANSACTIONS_NOT_SUPPORTED",
        );
    }
    return new HttpClient(url, expandedConfig.authToken);
}

export class HttpClient implements Client {
    #url: URL;
    #authToken: string | undefined;
    closed: boolean;

    /** @private */
    constructor(url: URL, authToken: string | undefined) {
        this.#url = url;
        this.#authToken = authToken;
        this.closed = false;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        try {
            const hranaStmt = stmtToHrana(stmt);
            const protoStmt = hrana.raw.stmtToProto(hranaStmt, true);
            const response = await this.#send<ExecuteReq, ExecuteResp>(
                "POST", "v1/execute", {stmt: protoStmt});
            const protoStmtResult = response["result"];
            const hranaRows = hrana.raw.rowsResultFromProto(protoStmtResult);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        throw new LibsqlError("Batches are not yet implemented", "NOT_IMPLEMENTED");
    }

    async transaction(): Promise<never> {
        throw new LibsqlError(
            "Transactions are disabled and the HTTP client does not support them. " +
            "Please set `transactions` to true in the config and make sure that you use " +
            "libsql:// or libsqls:// in the URL, so that the client connects using a WebSocket.",
            "TRANSACTIONS_DISABLED",
        );
    }

    close(): void {
        this.closed = true;
    }

    async #send<Req, Resp>(method: string, path: string, reqBody: Req): Promise<Resp> {
        const url = new URL(path, this.#url);
        const headers: Record<string, string> = {};
        if (this.#authToken !== undefined) {
            headers["authorization"] = `Bearer ${this.#authToken}`;
        }

        const resp = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(reqBody),
        });

        const respType = resp.headers.get("content-type") ?? "text/plain";
        if (!resp.ok) {
            if (respType === "application/json") {
                const respBody = await resp.json();
                if ("message" in respBody) {
                    // TODO: use the error code from the server, once implemented
                    throw new LibsqlError(respBody["message"], undefined);
                }
            } else if (respType === "text/plain") {
                const respBody = await resp.text();
                throw new LibsqlError(
                    `Server returned HTTP status ${resp.status} and error: ${respBody}`,
                    "SERVER_ERROR",
                );
            }
            throw new LibsqlError(`Server returned HTTP status ${resp.status}`, "SERVER_ERROR");
        }

        return await resp.json() as Resp;
    }

    #checkNotClosed(): void {
        if (this.closed) {
            throw new LibsqlError("The client was closed", "CLIENT_CLOSED");
        }
    }
}

type ExecuteReq = {
    "stmt": hrana.proto.Stmt,
}

type ExecuteResp = {
    "result": hrana.proto.StmtResult,
}
