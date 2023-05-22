const ngrok = require("ngrok");
const wrangler = require("wrangler");

const testCases = [
    {testCase: "/execute", http: true},
    {testCase: "/batch", http: true},
    {testCase: "/transaction", http: false},
];

async function main() {
    const local = !!parseInt(process.env.LOCAL ?? "1");
    const url = new URL(process.env.URL ?? "ws://localhost:8080");

    let clientUrlInsideWorker;
    let tunnelUrl = undefined;
    if (local) {
        clientUrlInsideWorker = url;
    } else {
        console.info(`Creating an ngrok tunnel to ${url}...`);
        tunnelUrl = await ngrok.connect({
            proto: "http",
            addr: url.host,
            authtoken: process.env.NGROK_AUTHTOKEN,
        });

        clientUrlInsideWorker = new URL(tunnelUrl);
        if (url.protocol === "http:") {
            clientUrlInsideWorker.protocol = "https:";
        } else if (url.protocol === "ws:") {
            clientUrlInsideWorker.protocol = "wss:";
        } else {
            clientUrlInsideWorker.protocol = url.protocol;
        }

        console.info(`Established a localtunnel on ${clientUrlInsideWorker}`);
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
        if (tunnelUrl !== undefined) {
            console.info("Closing ngrok tunnel...");
            await ngrok.disconnect(tunnelUrl);
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

    const clientProtocol = clientUrlInsideWorker.protocol;
    const clientIsHttp = clientProtocol === "http:" || clientProtocol === "https:";

    try {
        let ok = true;
        for (const {testCase, http} of testCases) {
            if (!http && clientIsHttp) {
                continue;
            }
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
