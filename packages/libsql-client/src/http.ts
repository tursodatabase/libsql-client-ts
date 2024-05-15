import * as hrana from "@libsql/hrana-client";

import type { Config, Client } from "@libsql/core/api";
import type { BatchConfig, InStatement, ResultSet, Transaction, IntMode } from "@libsql/core/api";
import { TransactionMode, LibsqlError } from "@libsql/core/api";
import type { ExpandedConfig } from "@libsql/core/config";
import { expandConfig } from "@libsql/core/config";
import {
    HranaTransaction, executeHranaBatch,
    stmtToHrana, resultSetFromHrana, mapHranaError,
} from "./hrana.js";
import { SqlCache } from "./sql_cache.js";
import { encodeBaseUrl } from "@libsql/core/uri";
import { supportedUrlLink } from "@libsql/core/util";

type MigrationJobType = {
  job_id: number;
  status: string;
}

type ExtendedMigrationJobType = MigrationJobType & {
  progress: Array<{
    namespace: string
    status: string
    error: string | null
  }>;
};

type MigrationResult = {
  schema_version: number;
  migrations: Array<MigrationJobType>;
};

const SCHEMA_MIGRATION_SLEEP_TIME_IN_MS = 1
const SCHEMA_MIGRATION_MAX_RETRIES = 2

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export * from "@libsql/core/api";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    if (config.scheme !== "https" && config.scheme !== "http") {
        throw new LibsqlError(
            'The HTTP client supports only "libsql:", "https:" and "http:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }

    if (config.encryptionKey !== undefined) {
        throw new LibsqlError("Encryption key is not supported by the remote client.", "ENCRYPTION_KEY_NOT_SUPPORTED");
    }

    if (config.scheme === "http" && config.tls) {
        throw new LibsqlError(`A "http:" URL cannot opt into TLS by using ?tls=1`, "URL_INVALID");
    } else if (config.scheme === "https" && !config.tls) {
        throw new LibsqlError(`A "https:" URL cannot opt out of TLS by using ?tls=0`, "URL_INVALID");
    }

    const url = encodeBaseUrl(config.scheme, config.authority, config.path);
    return new HttpClient(url, config.authToken, config.intMode, config.fetch);
}

const sqlCacheCapacity = 30;

export class HttpClient implements Client {
    #client: hrana.HttpClient;
    protocol: "http";
    url: URL;
    authToken: string | undefined;

    /** @private */
    constructor(
        url: URL,
        authToken: string | undefined,
        intMode: IntMode,
        customFetch: Function | undefined,
    ) {
        this.#client = hrana.openHttp(url, authToken, customFetch);
        this.#client.intMode = intMode;
        this.protocol = "http";
        this.url = url;
        this.authToken = authToken;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        try {
            const hranaStmt = stmtToHrana(stmt);

            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the statement and
            // close the stream in a single HTTP request.
            let rowsPromise: Promise<hrana.RowsResult>;
            const stream = this.#client.openStream();
            try {
                rowsPromise = stream.query(hranaStmt);
            } finally {
                stream.closeGracefully();
            }

            return resultSetFromHrana(await rowsPromise);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async isMigrationJobFinished(jobId: number): Promise<boolean> {
      const url = this.url.origin + `/v1/jobs/${jobId}`;
      console.log("isMigrationJobFinished url:", url)
      const result = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
        },
      });
      const json = (await result.json()) as ExtendedMigrationJobType;
      console.log("json:", json)
      const job = json as { status: string };
      if(result.status !== 200) {
        throw new Error(`Unexpected status code while fetching job status for migration with id ${jobId}: ${result.status}`);
      }

      if(job.status == "RunFailure") {
        throw new Error("Migration job failed");
      }

    return job.status == "RunSuccess"
    }

    async getLastMigrationJob(): Promise<MigrationJobType> {
      const url = this.url.origin + "/v1/jobs";
      const result = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
        },
      });
      if(result.status !== 200) {
        throw new Error("Unexpected status code while fetching migration jobs: " + result.status);
      }

      const json = (await result.json()) as MigrationResult;
      console.log("json:", json)
      if(!json.migrations || json.migrations.length === 0) {
        throw new Error("No migrations found");
      }

      const migrations = json.migrations || [];
      let lastJob: MigrationJobType | undefined;
      for (const migration of migrations) {
        if (migration.job_id > (lastJob?.job_id || 0)) {
          lastJob = migration;
        }
      }
      if(!lastJob) {
        throw new Error("No migration job found");
      }
      if (lastJob?.status === "RunFailure") {
        throw new Error("Last migration job failed");
      }

      return lastJob;
    }

    async batch(
      stmts: Array<InStatement>, 
      mode: TransactionMode | BatchConfig = "deferred"
    ): Promise<Array<ResultSet>> {
        try {
            const hranaStmts = stmts.map(stmtToHrana);
            const version = await this.#client.getVersion();

            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the batch and
            // close the stream in a single HTTP request.
            let resultsPromise: Promise<Array<ResultSet>>;
            const stream = this.#client.openStream();
            try {
                // It makes sense to use a SQL cache even for a single batch, because it may contain the same
                // statement repeated multiple times.
                const sqlCache = new SqlCache(stream, sqlCacheCapacity);
                sqlCache.apply(hranaStmts);

                // TODO: we do not use a cursor here, because it would cause three roundtrips:
                // 1. pipeline request to store SQL texts
                // 2. cursor request
                // 3. pipeline request to close the stream
                const batch = stream.batch(false);
                const transactionMode = typeof mode === "string" ? mode : mode.transactionMode || "deferred";
                resultsPromise = executeHranaBatch(transactionMode, version, batch, hranaStmts);
            } finally {
                stream.closeGracefully();
            }

            const wait = typeof mode === "string" ? false : mode.wait;
            if (wait) {
              console.log('Waiting for migration jobs');
              const lastMigrationJob = await this.getLastMigrationJob();
              console.log("lastMigrationJob:", lastMigrationJob)
              if(lastMigrationJob.status !== "RunSuccess") {
                let i = 0
                while(i < SCHEMA_MIGRATION_MAX_RETRIES) {
                  i++;
                  console.log("Waiting for migration job to finish, attempt:", i);
                  const isLastMigrationJobFinished = await this.isMigrationJobFinished(lastMigrationJob.job_id);
                  console.log("isLastMigrationJobFinished:", isLastMigrationJobFinished)
                  await sleep(SCHEMA_MIGRATION_SLEEP_TIME_IN_MS);
                }
              }
              console.log('Finished waiting for migration jobs');
            } else {
              console.log("Not waiting for migration jobs");
            }

            return await resultsPromise;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async transaction(mode: TransactionMode = "write"): Promise<HttpTransaction> {
        try {
            const version = await this.#client.getVersion();
            return new HttpTransaction(this.#client.openStream(), mode, version);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async executeMultiple(sql: string): Promise<void> {
        try {
            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the sequence and
            // close the stream in a single HTTP request.
            let promise: Promise<void>;
            const stream = this.#client.openStream();
            try {
                promise = stream.sequence(sql);
            } finally {
                stream.closeGracefully();
            }

            await promise;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    sync(): Promise<void> {
        throw new LibsqlError("sync not supported in http mode", "SYNC_NOT_SUPPORTED");
    }

    close(): void {
        this.#client.close();
    }

    get closed(): boolean {
        return this.#client.closed;
    }
}

export class HttpTransaction extends HranaTransaction implements Transaction {
    #stream: hrana.HttpStream;
    #sqlCache: SqlCache;

    /** @private */
    constructor(stream: hrana.HttpStream, mode: TransactionMode, version: hrana.ProtocolVersion) {
        super(mode, version);
        this.#stream = stream;
        this.#sqlCache = new SqlCache(stream, sqlCacheCapacity);
    }

    /** @private */
    override _getStream(): hrana.Stream {
        return this.#stream;
    }

    /** @private */
    override _getSqlCache(): SqlCache {
        return this.#sqlCache;
    }

    override close(): void {
        this.#stream.close();
    }

    override get closed(): boolean {
        return this.#stream.closed;
    }
}
