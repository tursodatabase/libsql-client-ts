const localtunnel = require("localtunnel");
const wrangler = require("wrangler");

const testCases = ["/execute", "/batch", "/transaction"];

async function main() {
    const local = !!parseInt(process.env.LOCAL ?? "1");
    const url = new URL(process.env.URL ?? "ws://localhost:8080");

    let clientUrlInsideWorker;
    let tunnel = undefined;
    if (local) {
        clientUrlInsideWorker = url;
    } else {
        console.info(`Creating an tunnel to ${url}...`);
        tunnel = await localtunnel({
            port: url.port,
            local_host: url.hostname,
        });

        clientUrlInsideWorker = new URL(tunnel.url);
        if (url.protocol === "http:") {
            clientUrlInsideWorker.protocol = "https:";
        } else if (url.protocol === "ws:") {
            clientUrlInsideWorker.protocol = "wss:";
        } else {
            clientUrlInsideWorker.protocol = url.protocol;
        }

        console.info(`Established a tunnel on ${clientUrlInsideWorker}`);
    }

    let ok = false;
    try {
        ok = await runWorker(local, clientUrlInsideWorker);
        if (ok) {
            console.log("All tests passed");
        } else {
            console.error("Some tests failed");
        }
    } finally {
        if (tunnel !== undefined) {
            console.info("Closing tunnel...");
            await tunnel.close();
        }

        // TODO: wrangler keeps the program running:
        // https://github.com/cloudflare/workers-sdk/issues/2892
        setTimeout(() => process.exit(ok ? 0 : 1), 200);
    }
}

async function runWorker(local, clientUrlInsideWorker) {
    console.info(`Creating a ${local ? 'local' : 'nonlocal'} Worker...`);
    const worker = await wrangler.unstable_dev("worker.js", {
        config: "wrangler.toml",
        logLevel: "info",
        local,
        vars: {
            "CLIENT_URL": clientUrlInsideWorker.toString(),
        },
        experimental: {
            disableExperimentalWarning: true,
        }
    });
    console.info(`Worker created on ${worker.address}:${worker.port}`);

    try {
        let ok = true;
        for (const testCase of testCases) {
            if (!await runTest(worker, testCase)) {
                ok = false;
            }
        }
        return ok;
    } finally {
        console.info("Stopping Worker...");
        await worker.stop();
    }
}

async function runTest(worker, testCase) {
    const resp = await worker.fetch(testCase);
    const respText = await resp.text();
    const ok = resp.status === 200 && respText === "Test passed";
    if (ok) {
        console.info(`TEST ${testCase}: passed`);
    } else {
        console.warn(`\nTEST ${testCase}: failed with status ${resp.status}\n${respText}\n`);
    }
    return ok;
}

main();
