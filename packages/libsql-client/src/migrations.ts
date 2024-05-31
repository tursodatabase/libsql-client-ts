type MigrationJobType = {
    job_id: number;
    status: string;
};

type ExtendedMigrationJobType = MigrationJobType & {
    progress: Array<{
        namespace: string;
        status: string;
        error: string | null;
    }>;
};

type MigrationResult = {
    schema_version: number;
    migrations: Array<MigrationJobType>;
};

const SCHEMA_MIGRATION_SLEEP_TIME_IN_MS = 1000;
const SCHEMA_MIGRATION_MAX_RETRIES = 30;

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

type isMigrationJobFinishedProps = {
    authToken: string | undefined;
    baseUrl: string;
    jobId: number;
};

async function isMigrationJobFinished({
    authToken,
    baseUrl,
    jobId,
}: isMigrationJobFinishedProps): Promise<boolean> {
    const url = normalizeURLScheme(baseUrl + `/v1/jobs/${jobId}`);
    const result = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });
    const json = (await result.json()) as ExtendedMigrationJobType;
    const job = json as { status: string };
    if (result.status !== 200) {
        throw new Error(
            `Unexpected status code while fetching job status for migration with id ${jobId}: ${result.status}`,
        );
    }

    if (job.status == "RunFailure") {
        throw new Error("Migration job failed");
    }

    return job.status == "RunSuccess";
}

type getLastMigrationJobProps = {
    authToken: string | undefined;
    baseUrl: string;
};

function normalizeURLScheme(url: string) {
    if (url.startsWith("ws://")) {
        return url.replace("ws://", "http://");
    }
    if (url.startsWith("wss://")) {
        return url.replace("wss://", "https://");
    }

    return url;
}

export async function getIsSchemaDatabase({
    authToken,
    baseUrl,
}: {
    authToken: string | undefined;
    baseUrl: string;
}) {
    const url = normalizeURLScheme(baseUrl + "/v1/jobs");
    const result = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });
    if (result.status === 404) {
        return false;
    }

    const json = (await result.json()) as { error: string };

    const isChildDatabase =
        result.status === 400 && json.error === "Invalid namespace";
    return !isChildDatabase;
}

async function getLastMigrationJob({
    authToken,
    baseUrl,
}: getLastMigrationJobProps): Promise<MigrationJobType> {
    const url = normalizeURLScheme(baseUrl + "/v1/jobs");
    const result = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });
    if (result.status !== 200) {
        throw new Error(
            "Unexpected status code while fetching migration jobs: " +
                result.status,
        );
    }

    const json = (await result.json()) as MigrationResult;
    if (!json.migrations || json.migrations.length === 0) {
        throw new Error("No migrations found");
    }

    const migrations = json.migrations || [];
    let lastJob: MigrationJobType | undefined;
    for (const migration of migrations) {
        if (migration.job_id > (lastJob?.job_id || 0)) {
            lastJob = migration;
        }
    }
    if (!lastJob) {
        throw new Error("No migration job found");
    }
    if (lastJob?.status === "RunFailure") {
        throw new Error("Last migration job failed");
    }

    return lastJob;
}

type waitForLastMigrationJobToFinishProps = {
    authToken: string | undefined;
    baseUrl: string;
};

export async function waitForLastMigrationJobToFinish({
    authToken,
    baseUrl,
}: getLastMigrationJobProps) {
    const lastMigrationJob = await getLastMigrationJob({
        authToken: authToken,
        baseUrl,
    });
    if (lastMigrationJob.status !== "RunSuccess") {
        let i = 0;
        while (i < SCHEMA_MIGRATION_MAX_RETRIES) {
            i++;
            const isLastMigrationJobFinished = await isMigrationJobFinished({
                authToken: authToken,
                baseUrl,
                jobId: lastMigrationJob.job_id,
            });
            if (isLastMigrationJobFinished) {
                break;
            }

            await sleep(SCHEMA_MIGRATION_SLEEP_TIME_IN_MS);
        }
    }
}
