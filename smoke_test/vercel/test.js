const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fetch = require("node-fetch");
const localtunnel = require("localtunnel");

function getEnv(name) {
    const value = process.env[name] ?? "";
    if (!value) {
        throw new Error(`Please set the env variable ${name}`);
    }
    return value;
}

const vercelToken = getEnv("VERCEL_TOKEN");
const projectName = getEnv("VERCEL_PROJECT_NAME");

async function npm(subcommand, args, hiddenArgs = [], {capture = false} = {}) {
    console.info(`$ npm ${subcommand} ${args.join(' ')}`);

    const proc = spawn("npm", [subcommand, ...args, ...hiddenArgs], {
        stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });

    const exitPromise = new Promise((resolve, reject) => {
        proc.on("exit", (code, signal) => {
            if (signal !== null) {
                reject(new Error(`vercel command terminated due to signal: ${signal}`));
            } else if (code !== 0) {
                reject(new Error(`vercel command exited with code: ${code}`));
            } else {
                resolve();
            }
        });
    });

    const dataPromise = new Promise((resolve, reject) => {
        if (!capture) {
            return resolve();
        }

        const stream = proc.stdout;
        stream.setEncoding("utf-8");

        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(chunks.join("")));
        stream.on("error", (e) => reject(e));
    });

    return exitPromise.then(() => dataPromise);
}

async function deployToVercel(clientUrlInsideVercel) {
    console.info("Building and deploying to Vercel...");

    let tarballName = await npm("pack", ["../.."], [], {capture: true});
    tarballName = tarballName.trim();

    const appPackageJson = {
        "dependencies": {
            "@libsql/client": `../${tarballName}`,
        },
    };
    fs.writeFileSync("app/package.json", JSON.stringify(appPackageJson, null, 4));

    await npm(
        "exec",
        ["--", "vercel", "link", "--yes", "--project", projectName, "--cwd", "app/"],
        ["--token", vercelToken],
    );
    await npm(
        "exec",
        ["--", "vercel", "pull", "--yes", "--environment=preview", "--cwd", "app/"],
        ["--token", vercelToken],
    );
    await npm(
        "exec",
        ["--", "vercel", "build", "--cwd", "app/"],
    );

    const deployUrl = await npm(
        "exec",
        [
            "--", "vercel", "deploy", "--prebuilt",
            "--env", `CLIENT_URL=${clientUrlInsideVercel}`, "--cwd", "app/",
        ],
        ["--token", vercelToken, "--cwd", "app/"],
        {capture: true},
    );

    console.info(`Deployed Vercel project on ${deployUrl}`);
    return deployUrl;
}

const testCases = ["execute", "batch", "transaction"];

async function runTests(functionUrl) {
    let ok = true;
    for (const testCase of testCases) {
        if (!await runTest(functionUrl, testCase)) {
            ok = false;
        }
    }
    return ok;
}

async function runTest(functionUrl, testCase) {
    const resp = await fetch(`${functionUrl}?test=${testCase}`);
    const respText = await resp.text();
    const ok = resp.status === 200 && respText === "Test passed";
    if (ok) {
        console.info(`TEST ${testCase}: passed`);
    } else {
        console.warn(`\nTEST ${testCase}: failed with status ${resp.status}\n${respText}\n`);
    }
    return ok;
}

async function main() {
    const url = new URL(process.env.URL ?? "ws://localhost:8080");

    console.info(`Creating a tunnel to ${url}...`);
    const tunnel = await localtunnel({
        port: url.port,
        local_host: url.hostname,
    });

    clientUrlInsideVercel = new URL(tunnel.url);
    if (url.protocol === "http:") {
        clientUrlInsideVercel.protocol = "https:";
    } else if (url.protocol === "ws:") {
        clientUrlInsideVercel.protocol = "wss:";
    } else {
        clientUrlInsideVercel.protocol = url.protocol;
    }

    console.info(`Established a tunnel on ${clientUrlInsideVercel}`);

    let ok = false;
    try {
        const deployUrl = await deployToVercel(clientUrlInsideVercel);
        const functionUrl = new URL("api/function", deployUrl);
        ok = await runTests(functionUrl);
        if (ok) {
            console.log("All tests passed");
        } else {
            console.error("Some tests failed");
        }
    } finally {
        console.info("Closing the tunnel...");
        await tunnel.close();
    }

    process.exit(ok ? 0 : 1);
}

main();
