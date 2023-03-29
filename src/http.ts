import * as hrana from "@libsql/hrana-client";
import { fetch } from "cross-fetch";

import type { Config, Client } from "./api.js";
import { InStatement, ResultSet, LibsqlError } from "./api.js";
import { expandConfig, mapLibsqlUrl } from "./config.js";
import { stmtToHrana, resultSetFromHrana, mapHranaError } from "./hrana.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    const expandedConfig = expandConfig(config);
    const url = mapLibsqlUrl(expandedConfig.url, "https:");
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
            const request = {"stmt": protoStmt};
            const response = await this.#send<ExecuteReq, ExecuteResp>("POST", "v1/execute", request);
            const protoStmtResult = response["result"];
            const hranaRows = hrana.raw.rowsResultFromProto(protoStmtResult);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        try {
            const protoSteps: Array<hrana.proto.BatchStep> = [];

            protoSteps.push({
                "stmt": {"sql": "BEGIN", "want_rows": false},
            });
            const beginStepIdx = protoSteps.length - 1;

            let lastStepIdx = beginStepIdx;
            for (const stmt of stmts) {
                const hranaStmt = stmtToHrana(stmt);
                protoSteps.push({
                    "condition": {"type": "ok", "step": lastStepIdx},
                    "stmt": hrana.raw.stmtToProto(hranaStmt, true),
                });
                lastStepIdx = protoSteps.length - 1;
            }

            protoSteps.push({
                "condition": {"type": "ok", "step": lastStepIdx},
                "stmt": {"sql": "COMMIT", "want_rows": false},
            });
            const commitStepIdx = protoSteps.length - 1;

            protoSteps.push({
                "condition": {
                    "type": "not",
                    "cond": {"type": "ok", "step": commitStepIdx},
                },
                "stmt": {"sql": "ROLLBACK", "want_rows": false},
            });

            const protoBatch = {"steps": protoSteps};
            const request = {"batch": protoBatch};
            const response = await this.#send<BatchReq, BatchResp>("POST", "v1/batch", request);
            const protoBatchResult = response["result"];

            for (let stepIdx = beginStepIdx; stepIdx <= commitStepIdx; ++stepIdx) {
                const protoError = protoBatchResult["step_errors"][stepIdx];
                if (protoError !== null) {
                    throw hrana.raw.errorFromProto(protoError);
                }
            }

            const resultSets = [];
            for (let i = 0; i < stmts.length; ++i) {
                const stepIdx = beginStepIdx + 1 + i;
                const protoStmtResult = protoBatchResult["step_results"][stepIdx];
                if (protoStmtResult === null) {
                    throw new LibsqlError("Server did not return a result", "SERVER_ERROR");
                }
                const hranaRows = hrana.raw.rowsResultFromProto(protoStmtResult);
                resultSets.push(resultSetFromHrana(hranaRows));
            }
            return resultSets;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async transaction(): Promise<never> {
        throw new LibsqlError(
            "The HTTP client does not support transactions. " +
            "Please use a libsql:, ws: or wss: URL, so that the client connects using a WebSocket.",
            "TRANSACTIONS_NOT_SUPPORTED",
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
                    const code = respBody["code"] ?? "UNKNOWN";
                    throw new LibsqlError(respBody["message"], code);
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

type BatchReq = {
    "batch": hrana.proto.Batch,
}
type BatchResp = {
    "result": hrana.proto.BatchResult,
}
