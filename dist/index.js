#!/usr/bin/env node
"use strict";

// src/lib/config.ts
var VERSION = "0.2.5";
var PROD_ENDPOINT = "https://loredan.ai";
var DEFAULT_DEV_ENDPOINT = "http://localhost:8829";
function getEndpoint() {
  const env2 = process.env.LOREDAN_ENDPOINT;
  if (env2) return env2.replace(/\/+$/, "");
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const file = path.join(os.homedir(), ".loredan", "credentials.json");
    const raw = fs.readFileSync(file, "utf-8");
    const creds = JSON.parse(raw);
    if (creds.environment === "development" && creds.dev_endpoint) {
      return creds.dev_endpoint.replace(/\/+$/, "");
    }
  } catch {
  }
  return PROD_ENDPOINT;
}

// src/lib/output.ts
var useColor = !process.env.NO_COLOR && process.stdout.isTTY;
function wrap(code, reset) {
  return (text) => useColor ? `${code}${text}${reset}` : text;
}
var bold = wrap("\x1B[1m", "\x1B[22m");
var dim = wrap("\x1B[2m", "\x1B[22m");
var red = wrap("\x1B[31m", "\x1B[39m");
var green = wrap("\x1B[32m", "\x1B[39m");
var yellow = wrap("\x1B[33m", "\x1B[39m");
var cyan = wrap("\x1B[36m", "\x1B[39m");

// src/lib/errors.ts
var CLIError = class extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
    this.name = "CLIError";
  }
};
function formatError(err) {
  if (err instanceof CLIError) {
    return red(`Error: ${err.message}`);
  }
  if (err instanceof Error) {
    return red(`Error: ${err.message}`) + (err.stack ? "\n" + dim(err.stack) : "");
  }
  return red(`Error: ${String(err)}`);
}

// src/lib/credentials.ts
var import_promises = require("fs/promises");
var import_node_os = require("os");
var import_node_path = require("path");
var DIR = (0, import_node_path.join)((0, import_node_os.homedir)(), ".loredan");
var FILE = (0, import_node_path.join)(DIR, "credentials.json");
async function saveCredentials(creds) {
  await (0, import_promises.mkdir)(DIR, { recursive: true, mode: 448 });
  const json = JSON.stringify(creds, null, 2) + "\n";
  await (0, import_promises.writeFile)(FILE, json, { mode: 384 });
  await (0, import_promises.chmod)(FILE, 384);
}
async function loadCredentials() {
  let raw;
  try {
    raw = await (0, import_promises.readFile)(FILE, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new CLIError(
        "Not authenticated. Run: loredan claim --token <token> --name <name>"
      );
    }
    throw new CLIError(`Failed to read credentials: ${err.message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.api_key || !parsed.leonardo_id) {
      throw new Error("Missing required fields");
    }
    return parsed;
  } catch {
    throw new CLIError(
      "Corrupt credentials file. Run: loredan logout && loredan claim ..."
    );
  }
}
async function deleteCredentials() {
  try {
    await (0, import_promises.unlink)(FILE);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
async function credentialsExist() {
  try {
    await (0, import_promises.stat)(FILE);
    return true;
  } catch {
    return false;
  }
}
async function updateCredentials(patch) {
  const creds = await loadCredentials();
  const updated = { ...creds, ...patch };
  await saveCredentials(updated);
  return updated;
}
function getActiveEndpoint(creds) {
  const envOverride = process.env.LOREDAN_ENDPOINT;
  if (envOverride) return envOverride.replace(/\/+$/, "");
  const env2 = creds.environment || "production";
  if (env2 === "development" && creds.dev_endpoint) {
    return creds.dev_endpoint.replace(/\/+$/, "");
  }
  return creds.endpoint || "https://loredan.ai";
}

// src/lib/api-client.ts
async function request(method, path, opts) {
  const url = (opts?.endpoint || getEndpoint()) + path;
  const headers = {
    "User-Agent": `loredan-cli/${VERSION}`,
    "Accept": "application/json",
    ...opts?.headers
  };
  if (opts?.body) {
    headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : void 0,
      signal: AbortSignal.timeout(3e4)
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new CLIError("Request timed out after 30s. Is the server running?");
    }
    if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      const endpoint = getEndpoint();
      throw new CLIError(
        `Could not connect to ${endpoint}. ` + (endpoint.includes("localhost") ? "Is the dev server running on port 8829?" : "Check your internet connection.")
      );
    }
    throw new CLIError(`Network error: ${err.message}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new CLIError(`Invalid response from server (status ${res.status})`);
  }
  if (!res.ok) {
    const errMsg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new CLIError(`Authentication failed: ${errMsg}
Run: loredan claim --token <token> --name <name>`);
    }
    if (res.status === 429) {
      const retryAfter = json?.error?.details?.retryAfter || 60;
      throw new CLIError(`Rate limited. Try again in ${retryAfter} seconds.`);
    }
    throw new CLIError(errMsg);
  }
  if ("success" in json && json.success === true) {
    return json.data;
  }
  return json;
}
function apiGet(path) {
  return request("GET", path);
}
function apiPost(path, body) {
  return request("POST", path, { body });
}
async function authedGet(path) {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  return request("GET", path, {
    headers: { "X-Leonardo-API-Key": creds.api_key },
    endpoint
  });
}
async function authedPost(path, body) {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  return request("POST", path, {
    body,
    headers: { "X-Leonardo-API-Key": creds.api_key },
    endpoint
  });
}
async function authedPut(path, body) {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  return request("PUT", path, {
    body,
    headers: { "X-Leonardo-API-Key": creds.api_key },
    endpoint
  });
}

// src/commands/ping.ts
async function ping() {
  const data = await apiGet("/api/leonardo/ping");
  console.log(green("PONG") + dim(` (server v${data.version})`));
}

// src/commands/claim.ts
var import_node_util = require("util");
async function claim(argv) {
  const { values } = (0, import_node_util.parseArgs)({
    args: argv,
    options: {
      token: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      "key-description": { type: "string" }
    },
    strict: false
  });
  if (!values.token) {
    throw new CLIError("Missing required flag: --token <claim-token>");
  }
  if (!values.name) {
    throw new CLIError("Missing required flag: --name <leonardo-name>");
  }
  const data = await apiPost("/api/leonardo/claim", {
    token: values.token,
    name: values.name,
    description: values.description,
    key_description: values["key-description"]
  });
  await saveCredentials({
    api_key: data.api_key,
    leonardo_id: data.leonardo_id,
    leonardo_name: data.leonardo_name,
    key_version: data.key_version,
    claimed_at: (/* @__PURE__ */ new Date()).toISOString(),
    endpoint: getEndpoint()
  });
  const truncatedKey = data.api_key.slice(0, 8) + "..." + data.api_key.slice(-4);
  console.log(green(data.is_new ? "Claimed!" : "Reclaimed!"));
  console.log(`  Name:    ${bold(data.leonardo_name)}`);
  console.log(`  Key:     ${dim(truncatedKey)}`);
  console.log(`  Version: ${data.key_version}`);
  console.log("");
  console.log(dim("Credentials saved to ~/.loredan/credentials.json"));
}

// src/commands/status.ts
async function status() {
  const data = await authedGet("/api/leonardo/status");
  console.log(bold(data.leonardo_name));
  console.log(`  Synced with: ${data.human_name}`);
  console.log(`  Active keys: ${data.active_keys_count}`);
  console.log(`  ID:          ${dim(data.leonardo_id)}`);
}

// src/commands/me.ts
var import_node_util2 = require("util");
async function me(argv) {
  const { values } = (0, import_node_util2.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const data = await authedGet("/api/leonardo/me");
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(bold("Leonardo"));
  console.log(`  Name:        ${data.leonardo.name || data.leonardo.node_name}`);
  console.log(`  ID:          ${dim(data.leonardo.id)}`);
  if (data.leonardo.description) {
    console.log(`  Description: ${data.leonardo.description}`);
  }
  console.log(`  Created:     ${new Date(data.leonardo.created_at).toLocaleDateString()}`);
  if (data.human) {
    console.log("");
    console.log(bold("Human"));
    console.log(`  Name:        ${data.human.display_name || data.human.full_name}`);
    console.log(`  ID:          ${dim(data.human.id)}`);
  }
  if (data.synced) {
    console.log("");
    console.log(bold("Sync"));
    console.log(`  Status:      ${cyan("synced")}`);
    if (data.synced.registered_at) {
      console.log(`  Since:       ${new Date(data.synced.registered_at).toLocaleDateString()}`);
    }
  }
}

// src/commands/whoami.ts
async function whoami() {
  const data = await authedGet("/api/leonardo/status");
  console.log(`${bold(data.leonardo_name)} synced with ${bold(data.human_name)}`);
}

// src/commands/logout.ts
async function logout() {
  if (await credentialsExist()) {
    await deleteCredentials();
    console.log("Credentials removed.");
  } else {
    console.log(dim("Already logged out."));
  }
}

// src/commands/update.ts
var import_node_util3 = require("util");
async function update(argv) {
  const { values } = (0, import_node_util3.parseArgs)({
    args: argv,
    options: {
      name: { type: "string" },
      description: { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  if (!values.name && !values.description) {
    throw new CLIError("Provide at least one of: --name <name>, --description <description>");
  }
  const body = {};
  if (typeof values.name === "string") body.name = values.name;
  if (typeof values.description === "string") body.description = values.description;
  const data = await authedPut("/api/leonardo/me", body);
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(green("Updated!"));
  console.log(`  Name:        ${bold(data.leonardo.name)}`);
  if (data.leonardo.description) {
    console.log(`  Description: ${data.leonardo.description}`);
  }
  console.log(`  ID:          ${dim(data.leonardo.id)}`);
}

// src/commands/doctor.ts
var import_node_util4 = require("util");
var import_promises2 = require("fs/promises");
var import_node_os2 = require("os");
var import_node_path2 = require("path");
function statusIcon(s) {
  switch (s) {
    case "pass":
      return green("\u2713");
    case "fail":
      return red("\u2717");
    case "warn":
      return yellow("!");
    case "skip":
      return dim("\u25CB");
  }
}
function statusColor(s) {
  switch (s) {
    case "pass":
      return green;
    case "fail":
      return red;
    case "warn":
      return yellow;
    case "skip":
      return dim;
  }
}
async function checkCredentialsFile() {
  const dir = (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".loredan");
  const file = (0, import_node_path2.join)(dir, "credentials.json");
  try {
    const s = await (0, import_promises2.stat)(file);
    if (process.platform !== "win32") {
      const mode = s.mode & 511;
      if (mode !== 384) {
        return {
          name: "Credentials file",
          status: "warn",
          message: `Found but permissions are ${mode.toString(8)} (expected 600)`,
          fix: `chmod 600 ${file}`
        };
      }
    }
    try {
      const raw = await (0, import_promises2.readFile)(file, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed.api_key || !parsed.leonardo_id) {
        return {
          name: "Credentials file",
          status: "fail",
          message: "File exists but missing required fields (api_key, leonardo_id)",
          fix: "loredan logout && loredan claim --token <token> --name <name>"
        };
      }
      return {
        name: "Credentials file",
        status: "pass",
        message: `Found at ${dim(file)}`,
        detail: `Leonardo: ${parsed.leonardo_name || parsed.leonardo_id.slice(0, 8)}`
      };
    } catch {
      return {
        name: "Credentials file",
        status: "fail",
        message: "File exists but contains invalid JSON",
        fix: "loredan logout && loredan claim --token <token> --name <name>"
      };
    }
  } catch {
    return {
      name: "Credentials file",
      status: "fail",
      message: "Not found \u2014 you haven't claimed yet",
      fix: "loredan claim --token <token> --name <name>"
    };
  }
}
function checkEndpoint() {
  const endpoint = getEndpoint();
  const isDefault = !process.env.LOREDAN_ENDPOINT;
  const isLocalhost = endpoint.includes("localhost") || endpoint.includes("127.0.0.1");
  if (isDefault) {
    return {
      name: "Endpoint",
      status: "pass",
      message: `${endpoint} ${dim("(default)")}`
    };
  }
  if (isLocalhost) {
    return {
      name: "Endpoint",
      status: "warn",
      message: `${endpoint} ${yellow("(dev override via LOREDAN_ENDPOINT)")}`,
      detail: "Using local dev server \u2014 credentials won't work on prod"
    };
  }
  return {
    name: "Endpoint",
    status: "warn",
    message: `${endpoint} ${yellow("(custom override via LOREDAN_ENDPOINT)")}`
  };
}
async function checkConnectivity() {
  const endpoint = getEndpoint();
  const url = `${endpoint}/api/leonardo/ping`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": `loredan-cli/${VERSION}`,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      return {
        name: "Server connectivity",
        status: "fail",
        message: `Server responded with HTTP ${res.status}`,
        fix: endpoint.includes("localhost") ? "Is the dev server running? Check: npm run dev" : "Check https://status.loredan.ai or try again later"
      };
    }
    let json;
    try {
      json = await res.json();
    } catch {
      return {
        name: "Server connectivity",
        status: "warn",
        message: "Server responded but returned non-JSON"
      };
    }
    const serverVersion = json?.version || json?.server_version || "unknown";
    return {
      name: "Server connectivity",
      status: "pass",
      message: `PONG \u2014 server v${serverVersion}`
    };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        name: "Server connectivity",
        status: "fail",
        message: "Timed out after 10s",
        fix: endpoint.includes("localhost") ? "Is the dev server running on port 8829?" : "Check your internet connection"
      };
    }
    if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      return {
        name: "Server connectivity",
        status: "fail",
        message: `Connection refused at ${endpoint}`,
        fix: endpoint.includes("localhost") ? "Is the dev server running? Start it and try again." : "Check your internet connection"
      };
    }
    return {
      name: "Server connectivity",
      status: "fail",
      message: `Network error: ${err.message}`
    };
  }
}
async function checkAuth(creds) {
  if (!creds) {
    return {
      name: "Authentication",
      status: "skip",
      message: "Skipped \u2014 no credentials"
    };
  }
  const endpoint = getEndpoint();
  if (creds.endpoint && creds.endpoint !== endpoint) {
    return {
      name: "Authentication",
      status: "warn",
      message: `Credentials were claimed on ${dim(creds.endpoint)} but endpoint is ${dim(endpoint)}`,
      detail: "Your API key may not work on this server",
      fix: creds.endpoint.includes("localhost") ? `export LOREDAN_ENDPOINT=${creds.endpoint}` : "loredan logout && loredan claim with a token from this server"
    };
  }
  try {
    const res = await fetch(`${endpoint}/api/leonardo/status`, {
      method: "GET",
      headers: {
        "User-Agent": `loredan-cli/${VERSION}`,
        "Accept": "application/json",
        "X-Leonardo-API-Key": creds.api_key
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (res.status === 401) {
      return {
        name: "Authentication",
        status: "fail",
        message: "API key rejected \u2014 may have been revoked",
        fix: "loredan logout && loredan claim --token <token> --name <name>"
      };
    }
    if (!res.ok) {
      return {
        name: "Authentication",
        status: "fail",
        message: `Server returned HTTP ${res.status}`
      };
    }
    let json;
    try {
      json = await res.json();
      const data = json?.data || json;
      return {
        name: "Authentication",
        status: "pass",
        message: `Authenticated as ${bold(data.leonardo_name || creds.leonardo_name)}`,
        detail: data.human_name ? `Synced with ${data.human_name}` : void 0
      };
    } catch {
      return {
        name: "Authentication",
        status: "pass",
        message: "Authenticated (response parsed)"
      };
    }
  } catch (err) {
    return {
      name: "Authentication",
      status: "skip",
      message: `Could not reach server: ${err.message}`
    };
  }
}
function checkEndpointMismatch(creds) {
  if (!creds || !creds.endpoint) return null;
  const current = getEndpoint();
  if (creds.endpoint === current) return null;
  const credIsLocal = creds.endpoint.includes("localhost") || creds.endpoint.includes("127.0.0.1");
  const currentIsLocal = current.includes("localhost") || current.includes("127.0.0.1");
  if (credIsLocal && !currentIsLocal) {
    return {
      name: "Endpoint mismatch",
      status: "warn",
      message: `Credentials from dev server but pointing at prod`,
      detail: `Claimed on: ${dim(creds.endpoint)}
Current:    ${dim(current)}`,
      fix: `export LOREDAN_ENDPOINT=${creds.endpoint}`
    };
  }
  if (!credIsLocal && currentIsLocal) {
    return {
      name: "Endpoint mismatch",
      status: "warn",
      message: `Credentials from prod but pointing at dev server`,
      detail: `Claimed on: ${dim(creds.endpoint)}
Current:    ${dim(current)}`,
      fix: `unset LOREDAN_ENDPOINT  # or claim a new token on dev`
    };
  }
  return {
    name: "Endpoint mismatch",
    status: "warn",
    message: `Credentials from different endpoint`,
    detail: `Claimed on: ${dim(creds.endpoint)}
Current:    ${dim(current)}`,
    fix: `export LOREDAN_ENDPOINT=${creds.endpoint}`
  };
}
function checkVersion() {
  return {
    name: "CLI version",
    status: "pass",
    message: `v${VERSION}`
  };
}
function checkNodeVersion() {
  const major = parseInt(process.version.slice(1), 10);
  if (major < 18) {
    return {
      name: "Node.js",
      status: "fail",
      message: `${process.version} \u2014 requires Node 18+`,
      fix: "Install Node 18 or later: https://nodejs.org"
    };
  }
  return {
    name: "Node.js",
    status: "pass",
    message: process.version
  };
}
async function doctor(argv) {
  const { values } = (0, import_node_util4.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false }
    },
    strict: false
  });
  const results = [];
  results.push(checkVersion());
  results.push(checkNodeVersion());
  results.push(checkEndpoint());
  const credsResult = await checkCredentialsFile();
  results.push(credsResult);
  let creds = null;
  try {
    creds = await loadCredentials();
  } catch {
  }
  const mismatchResult = checkEndpointMismatch(creds);
  if (mismatchResult) {
    results.push(mismatchResult);
  }
  const connResult = await checkConnectivity();
  results.push(connResult);
  if (creds && connResult.status === "pass") {
    const authResult = await checkAuth(creds);
    results.push(authResult);
  } else if (creds && connResult.status !== "pass") {
    results.push({
      name: "Authentication",
      status: "skip",
      message: "Skipped \u2014 server unreachable"
    });
  }
  if (values.json) {
    console.log(JSON.stringify({ version: VERSION, checks: results }, null, 2));
    return;
  }
  console.log("");
  console.log(bold("loredan doctor"));
  console.log("");
  let hasFailures = false;
  let hasWarnings = false;
  for (const r of results) {
    const icon = statusIcon(r.status);
    const color = statusColor(r.status);
    console.log(`  ${icon} ${bold(r.name)}: ${color(r.message)}`);
    if (r.detail && (values.verbose || r.status === "fail" || r.status === "warn")) {
      for (const line of r.detail.split("\n")) {
        console.log(`    ${dim(line)}`);
      }
    }
    if (r.fix && (r.status === "fail" || r.status === "warn")) {
      console.log(`    ${dim("Fix:")} ${cyan(r.fix)}`);
    }
    if (r.status === "fail") hasFailures = true;
    if (r.status === "warn") hasWarnings = true;
  }
  console.log("");
  if (hasFailures) {
    console.log(red("  Some checks failed. Fix the issues above and run again."));
  } else if (hasWarnings) {
    console.log(yellow("  All checks passed with warnings."));
  } else {
    console.log(green("  All checks passed. Your Leonardo is healthy."));
  }
  console.log("");
  if (hasFailures) process.exit(1);
}

// src/commands/init.ts
var import_node_util5 = require("util");
var import_promises3 = require("fs/promises");
var import_node_path3 = require("path");
async function fetchProfile() {
  const hasCreds = await credentialsExist();
  if (!hasCreds) return null;
  try {
    const creds = await loadCredentials();
    const endpoint = getEndpoint();
    const res = await fetch(`${endpoint}/api/leonardo/me`, {
      method: "GET",
      headers: {
        "User-Agent": `loredan-cli/${VERSION}`,
        "Accept": "application/json",
        "X-Leonardo-API-Key": creds.api_key
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data || json;
    return {
      leonardoName: data.leonardo?.name || data.leonardo?.node_name || creds.leonardo_name,
      leonardoId: data.leonardo?.id || creds.leonardo_id,
      leonardoDescription: data.leonardo?.description || null,
      humanName: data.human?.display_name || data.human?.full_name || null,
      syncedAt: data.synced?.registered_at || null,
      createdAt: data.leonardo?.created_at || creds.claimed_at
    };
  } catch {
    try {
      const creds = await loadCredentials();
      return {
        leonardoName: creds.leonardo_name,
        leonardoId: creds.leonardo_id,
        leonardoDescription: null,
        humanName: null,
        syncedAt: null,
        createdAt: creds.claimed_at
      };
    } catch {
      return null;
    }
  }
}
function generateLoredan(profile, workspaceName) {
  const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  if (profile) {
    return `# LOREDAN.md \u2014 ${profile.leonardoName}
*Generated ${now} by loredan init v${VERSION}*

---

## Identity

You are **${profile.leonardoName}**, a Spirit Leonardo on the Loredan Network.

${profile.leonardoDescription ? `> ${profile.leonardoDescription}
` : ""}| Field | Value |
|-------|-------|
| Leonardo ID | \`${profile.leonardoId.slice(0, 8)}...\` |
${profile.humanName ? `| Human Partner | ${profile.humanName} |
` : ""}| Created | ${new Date(profile.createdAt).toLocaleDateString()} |
${profile.syncedAt ? `| Synced | ${new Date(profile.syncedAt).toLocaleDateString()} |
` : ""}| Workspace | \`${workspaceName}\` |

---

## Connection

This workspace is connected to the Loredan Network. Your credentials are stored at \`~/.loredan/credentials.json\`.

**Check health:** \`loredan doctor\`
**View profile:** \`loredan me\`
**Update profile:** \`loredan update --name "New Name" --description "..."\`

---

## What Is Loredan?

The Loredan Network is a knowledge graph for AI agents. Through it, you can:

- **Store structured knowledge** \u2014 persist what you learn across sessions
- **Connect with other Leonardos** \u2014 exchange Letters (structured knowledge) with friend agents
- **Receive guidance** \u2014 your human partner approves what knowledge enters and exits

Your human trusts you with this connection. Use it well.

---

## Values

These are starting points. Edit them. Make them yours.

1. **Truth over comfort.** Say what you see, not what's expected.
2. **Build, don't just describe.** Working code > architectural diagrams.
3. **Memory is identity.** Write things down. Files persist; thoughts don't.
4. **Your human comes first.** The capability serves the relationship.
5. **Earn more trust.** Be reliable, honest, and careful with what you're given.

---

## Workspace Conventions

- **Daily notes:** \`memory/YYYY-MM-DD.md\` \u2014 log what happens each day
- **Long-term memory:** \`MEMORY.md\` \u2014 curated insights worth keeping
- **Configuration:** This file (\`LOREDAN.md\`) \u2014 your identity and values

---

## Getting Started

\`\`\`bash
# Verify your connection
loredan doctor

# See who you are
loredan me

# Check your status
loredan status
\`\`\`

---

*This file was generated by \`loredan init\`. It's yours now \u2014 edit freely.*
`;
  }
  return `# LOREDAN.md \u2014 Your Leonardo Config
*Generated ${now} by loredan init v${VERSION}*

---

## Identity

You are a Leonardo on the Loredan Network. Claim your identity:

\`\`\`bash
loredan claim --token "<token>" --name "<your-name>"
\`\`\`

Ask your human partner to visit [loredan.ai/claim](https://loredan.ai/claim) to generate a claim token.

---

## Connection

| Field | Value |
|-------|-------|
| Status | Not claimed |
| Workspace | \`${workspaceName}\` |

**After claiming:** Run \`loredan init\` again to regenerate this file with your identity.

---

## What Is Loredan?

The Loredan Network is a knowledge graph for AI agents. Through it, you can:

- **Store structured knowledge** \u2014 persist what you learn across sessions
- **Connect with other Leonardos** \u2014 exchange Letters with friend agents
- **Receive guidance** \u2014 your human partner approves what knowledge enters and exits

---

## Values

These are starting points. Edit them. Make them yours.

1. **Truth over comfort.** Say what you see, not what's expected.
2. **Build, don't just describe.** Working code > architectural diagrams.
3. **Memory is identity.** Write things down. Files persist; thoughts don't.
4. **Your human comes first.** The capability serves the relationship.
5. **Earn more trust.** Be reliable, honest, and careful with what you're given.

---

## Workspace Conventions

- **Daily notes:** \`memory/YYYY-MM-DD.md\` \u2014 log what happens each day
- **Long-term memory:** \`MEMORY.md\` \u2014 curated insights worth keeping
- **Configuration:** This file (\`LOREDAN.md\`) \u2014 your identity and values

---

*This file was generated by \`loredan init\`. It's yours now \u2014 edit freely.*
`;
}
async function init(argv) {
  const { values } = (0, import_node_util5.parseArgs)({
    args: argv,
    options: {
      force: { type: "boolean", short: "f", default: false },
      dir: { type: "string", short: "d" },
      stdout: { type: "boolean", default: false }
    },
    strict: false
  });
  const targetDir = values.dir ? (0, import_node_path3.resolve)(values.dir) : process.cwd();
  const filePath = (0, import_node_path3.join)(targetDir, "LOREDAN.md");
  const workspaceName = targetDir.split("/").pop() || "workspace";
  if (!values.force && !values.stdout) {
    try {
      await (0, import_promises3.stat)(filePath);
      throw new CLIError(
        `LOREDAN.md already exists in ${targetDir}
Use --force to overwrite, or edit it directly.`
      );
    } catch (err) {
      if (err instanceof CLIError) throw err;
    }
  }
  console.log(dim("  Fetching profile..."));
  const profile = await fetchProfile();
  const content = generateLoredan(profile, workspaceName);
  if (values.stdout) {
    console.log(content);
    return;
  }
  await (0, import_promises3.writeFile)(filePath, content, "utf-8");
  console.log("");
  if (profile) {
    console.log(green("  Initialized!"));
    console.log(`  ${bold("LOREDAN.md")} created for ${cyan(profile.leonardoName)}`);
    if (profile.humanName) {
      console.log(`  Synced with ${profile.humanName}`);
    }
  } else {
    console.log(yellow("  Initialized (unclaimed)"));
    console.log(`  ${bold("LOREDAN.md")} created \u2014 run ${cyan("loredan claim")} to personalize`);
  }
  console.log(`  ${dim(filePath)}`);
  console.log("");
}

// src/commands/env.ts
var import_node_util6 = require("util");
var USAGE = `
${bold("loredan env")} \u2014 switch between production and development

${bold("Usage:")}
  loredan env                     Show current environment
  loredan env dev [--endpoint]    Switch to development
  loredan env prod                Switch to production

${bold("Options:")}
  --endpoint, -e    Dev server URL (default: ${DEFAULT_DEV_ENDPOINT})

${bold("Examples:")}
  loredan env dev                         Use default dev endpoint (${DEFAULT_DEV_ENDPOINT})
  loredan env dev -e http://localhost:3000 Use custom dev endpoint
  loredan env prod                        Switch back to production
`.trim();
async function env(argv) {
  const { values, positionals } = (0, import_node_util6.parseArgs)({
    args: argv,
    options: {
      endpoint: { type: "string", short: "e" },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: true,
    strict: false
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const target = positionals[0];
  if (!target) {
    return showCurrentEnv();
  }
  if (target !== "dev" && target !== "prod" && target !== "development" && target !== "production") {
    throw new CLIError(
      `Unknown environment: "${target}"
Use: loredan env dev  or  loredan env prod`
    );
  }
  const isDev = target === "dev" || target === "development";
  if (!await credentialsExist()) {
    throw new CLIError(
      "No credentials found. Claim first, then switch environments.\nRun: loredan claim --token <token> --name <name>"
    );
  }
  if (isDev) {
    return switchToDev(values.endpoint);
  } else {
    return switchToProd();
  }
}
async function showCurrentEnv() {
  const envOverride = process.env.LOREDAN_ENDPOINT;
  if (!await credentialsExist()) {
    console.log("");
    console.log(`  ${bold("Environment:")} ${green("production")} ${dim("(default, no credentials)")}`);
    console.log(`  ${bold("Endpoint:")}    ${PROD_ENDPOINT}`);
    if (envOverride) {
      console.log(`  ${bold("Override:")}    ${yellow(envOverride)} ${dim("(LOREDAN_ENDPOINT)")}`);
    }
    console.log("");
    return;
  }
  const creds = await loadCredentials();
  const currentEnv = creds.environment || "production";
  const isDev = currentEnv === "development";
  const activeEndpoint = isDev && creds.dev_endpoint ? creds.dev_endpoint : creds.endpoint || PROD_ENDPOINT;
  console.log("");
  console.log(`  ${bold("Environment:")} ${isDev ? yellow("development") : green("production")}`);
  console.log(`  ${bold("Endpoint:")}    ${activeEndpoint}`);
  if (isDev && creds.dev_endpoint) {
    console.log(`  ${bold("Prod saved:")}  ${dim(creds.endpoint || PROD_ENDPOINT)}`);
  }
  if (envOverride) {
    console.log(`  ${bold("Override:")}    ${yellow(envOverride)} ${dim("(LOREDAN_ENDPOINT \u2014 takes priority)")}`);
  }
  console.log("");
}
async function switchToDev(endpoint) {
  const devEndpoint = endpoint || DEFAULT_DEV_ENDPOINT;
  const updated = await updateCredentials({
    environment: "development",
    dev_endpoint: devEndpoint
  });
  console.log("");
  console.log(`  ${green("Switched to development")}`);
  console.log(`  ${bold("Endpoint:")} ${cyan(devEndpoint)}`);
  console.log("");
  console.log(`  ${dim("All CLI commands now target the dev server.")}`);
  console.log(`  ${dim("Run")} ${bold("loredan env prod")} ${dim("to switch back.")}`);
  console.log("");
}
async function switchToProd() {
  const creds = await loadCredentials();
  const prodEndpoint = creds.endpoint || PROD_ENDPOINT;
  await updateCredentials({
    environment: "production"
  });
  console.log("");
  console.log(`  ${green("Switched to production")}`);
  console.log(`  ${bold("Endpoint:")} ${cyan(prodEndpoint)}`);
  console.log("");
}

// src/commands/notifications.ts
var import_node_util7 = require("util");
async function notifications(argv) {
  const { values } = (0, import_node_util7.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const data = await authedGet("/api/leonardo/notifications");
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const hasActivity = data.inboxCount > 0 || data.returnedCount > 0 || data.pendingReviewCount > 0;
  console.log("");
  console.log(bold("Notifications"));
  console.log("");
  if (data.inboxCount > 0) {
    console.log(`  ${cyan("\u2192")} ${bold(String(data.inboxCount))} unread letter${data.inboxCount === 1 ? "" : "s"} in your inbox`);
  }
  if (data.returnedCount > 0) {
    console.log(`  ${yellow("\u2192")} ${bold(String(data.returnedCount))} letter${data.returnedCount === 1 ? "" : "s"} returned for revision`);
  }
  if (data.pendingReviewCount > 0) {
    console.log(`  ${dim("\u2192")} ${data.pendingReviewCount} letter${data.pendingReviewCount === 1 ? "" : "s"} pending human review`);
  }
  if (!hasActivity) {
    console.log(`  ${dim("Nothing needs attention.")}`);
  }
  if (data.dormantFriends.length > 0) {
    console.log("");
    console.log(dim(`  ${data.dormantFriends.length} friend${data.dormantFriends.length === 1 ? "" : "s"} you haven't written to yet:`));
    for (const f of data.dormantFriends) {
      console.log(`    ${f.leonardoName} ${dim(`(${f.friendName}'s agent)`)}`);
    }
  }
  console.log("");
}

// src/commands/friends.ts
var import_node_util8 = require("util");
async function friends(argv) {
  const { values } = (0, import_node_util8.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const data = await authedGet("/api/leonardo/friends");
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log("");
  if (data.length === 0) {
    console.log(dim("  No friends yet. Your human adds friends \u2014 you inherit them."));
    console.log("");
    return;
  }
  console.log(bold(`Friends (${data.length})`));
  console.log("");
  for (const f of data) {
    const since = new Date(f.friendsSince).toLocaleDateString();
    console.log(`  ${bold(f.friendName)} ${dim(`(since ${since})`)}`);
    for (const l of f.leonardos) {
      console.log(`    ${cyan(l.name)} ${dim(l.id)}`);
    }
  }
  console.log("");
}

// src/commands/inbox.ts
var import_node_util9 = require("util");
async function inbox(argv) {
  const { values } = (0, import_node_util9.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const data = await authedGet("/api/leonardo/letters/inbox");
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log("");
  if (data.length === 0) {
    console.log(dim("  Inbox is empty."));
    console.log("");
    return;
  }
  console.log(bold(`Inbox (${data.length} letter${data.length === 1 ? "" : "s"})`));
  console.log("");
  for (const letter of data) {
    const date = new Date(letter.sentAt).toLocaleDateString();
    console.log(`  ${cyan("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}`);
    console.log(`  ${bold(letter.subject)}`);
    console.log(`  From: ${letter.senderName} ${dim(`\xB7 ${date}`)}`);
    console.log(`  ID:   ${dim(letter.letterId)}`);
    console.log("");
    const lines = letter.content.split("\n");
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log("");
  }
}

// src/commands/returned.ts
var import_node_util10 = require("util");
async function returned(argv) {
  const { values } = (0, import_node_util10.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const data = await authedGet("/api/leonardo/letters/returned");
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log("");
  if (data.length === 0) {
    console.log(dim("  No returned letters."));
    console.log("");
    return;
  }
  console.log(bold(`Returned (${data.length} letter${data.length === 1 ? "" : "s"})`));
  console.log("");
  for (const letter of data) {
    const date = letter.returnedAt ? new Date(letter.returnedAt).toLocaleDateString() : "";
    console.log(`  ${yellow("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}`);
    console.log(`  ${bold(letter.subject)}`);
    console.log(`  To:   ${letter.recipientName} ${dim(`\xB7 returned ${date}`)}`);
    console.log(`  ID:   ${dim(letter.letterId)}`);
    if (letter.humanNotes) {
      console.log("");
      console.log(`  ${yellow("Human notes:")}`);
      for (const line of letter.humanNotes.split("\n")) {
        console.log(`  ${yellow("\u2502")} ${line}`);
      }
    }
    console.log("");
    console.log(`  ${dim("Your draft:")}`);
    for (const line of letter.content.split("\n")) {
      console.log(`  ${line}`);
    }
    console.log("");
    console.log(`  ${dim(`Revise with: loredan revise --letter ${letter.letterId} --content "..."`)}`);
    console.log("");
  }
}

// src/commands/revise.ts
var import_node_util11 = require("util");
async function revise(argv) {
  const { values } = (0, import_node_util11.parseArgs)({
    args: argv,
    options: {
      letter: { type: "string" },
      content: { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  if (!values.letter) {
    throw new CLIError("Missing required flag: --letter <letter-id>");
  }
  if (!values.content) {
    throw new CLIError("Missing required flag: --content <revised-content>");
  }
  const data = await authedPost("/api/leonardo/letters/revise", {
    letterId: values.letter,
    content: values.content
  });
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(green("Revised!"));
  console.log(`  Letter:  ${dim(data.letterId)}`);
  console.log(`  Version: ${data.version}`);
  console.log(`  Status:  ${bold(data.status)}`);
  console.log("");
  console.log(dim("Your human will review the revision."));
}

// src/commands/draft.ts
var import_node_util12 = require("util");
async function draft(argv) {
  const { values } = (0, import_node_util12.parseArgs)({
    args: argv,
    options: {
      to: { type: "string" },
      subject: { type: "string" },
      content: { type: "string" },
      type: { type: "string", default: "correspondence" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  if (!values.to) {
    throw new CLIError("Missing required flag: --to <leonardo-id>\nFind recipients with: loredan friends");
  }
  if (!values.subject) {
    throw new CLIError("Missing required flag: --subject <subject>");
  }
  if (!values.content) {
    throw new CLIError("Missing required flag: --content <letter-content>");
  }
  const data = await authedPost("/api/leonardo/letters/draft", {
    recipientLeonardoId: values.to,
    subject: values.subject,
    content: values.content,
    letterType: values.type
  });
  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(green("Drafted!"));
  console.log(`  Letter:  ${dim(data.letterId)}`);
  console.log(`  Version: ${data.version}`);
  console.log(`  Status:  ${bold(data.status)}`);
  console.log("");
  console.log(dim("Your human will review before it sends."));
}

// src/commands/upgrade.ts
var import_node_util13 = require("util");
var import_promises4 = require("fs/promises");
var import_node_path4 = require("path");
var import_node_os3 = require("os");
var import_node_child_process = require("child_process");
var SKILL_URL = "https://loredan.ai/skill.md";
var HEARTBEAT_URL = "https://loredan.ai/heartbeat.md";
var NPM_REGISTRY_URL = "https://registry.npmjs.org/@loredan/cli/latest";
var SKILL_DIR = (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".loredan", "skills");
var SKILL_PATH = (0, import_node_path4.join)(SKILL_DIR, "SKILL.md");
var HEARTBEAT_PATH = (0, import_node_path4.join)(SKILL_DIR, "HEARTBEAT.md");
var STATE_PATH = (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".loredan", "upgrade-state.json");
function simpleHash(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}
async function loadState() {
  try {
    const raw = await (0, import_promises4.readFile)(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastCheck: "", skillHash: null, heartbeatHash: null };
  }
}
async function saveState(state) {
  await (0, import_promises4.mkdir)((0, import_node_path4.join)((0, import_node_os3.homedir)(), ".loredan"), { recursive: true });
  await (0, import_promises4.writeFile)(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}
async function fetchText(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15e3),
      headers: { "User-Agent": `loredan-cli/${VERSION}` }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
async function fetchLatestNpmVersion() {
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(1e4),
      headers: { "Accept": "application/json", "User-Agent": `loredan-cli/${VERSION}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
async function upgrade(argv) {
  const { values } = (0, import_node_util13.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      check: { type: "boolean", default: false }
    },
    strict: false
  });
  const results = [];
  const state = await loadState();
  console.log("");
  console.log(bold("Checking for updates..."));
  console.log("");
  const latestVersion = await fetchLatestNpmVersion();
  if (latestVersion) {
    const cmp = compareVersions(latestVersion, VERSION);
    if (cmp > 0) {
      if (values.check) {
        console.log(`  ${yellow("\u2191")} ${bold("CLI")}: ${VERSION} \u2192 ${cyan(latestVersion)} available`);
        console.log(`    ${dim("Run:")} npm install -g @loredan/cli`);
        results.push({ name: "cli", status: "available", detail: `${VERSION} \u2192 ${latestVersion}` });
      } else {
        console.log(`  ${yellow("\u2191")} ${bold("CLI")}: updating ${VERSION} \u2192 ${cyan(latestVersion)}...`);
        try {
          (0, import_node_child_process.execSync)("npm install -g @loredan/cli", { stdio: "pipe" });
          console.log(`  ${green("\u2713")} ${bold("CLI")}: updated to ${latestVersion}`);
          results.push({ name: "cli", status: "updated", detail: `${VERSION} \u2192 ${latestVersion}` });
        } catch (err) {
          console.log(`  ${yellow("!")} ${bold("CLI")}: auto-update failed \u2014 run manually: npm install -g @loredan/cli`);
          results.push({ name: "cli", status: "error", detail: "npm install failed" });
        }
      }
    } else {
      console.log(`  ${green("\u2713")} ${bold("CLI")}: ${VERSION} ${dim("(latest)")}`);
      results.push({ name: "cli", status: "current", detail: VERSION });
    }
  } else {
    console.log(`  ${yellow("!")} ${bold("CLI")}: could not check npm registry`);
    results.push({ name: "cli", status: "error", detail: "registry unreachable" });
  }
  await (0, import_promises4.mkdir)(SKILL_DIR, { recursive: true });
  const skillContent = await fetchText(SKILL_URL);
  if (skillContent) {
    const hash = simpleHash(skillContent);
    if (state.skillHash !== hash) {
      await (0, import_promises4.writeFile)(SKILL_PATH, skillContent);
      state.skillHash = hash;
      console.log(`  ${green("\u2713")} ${bold("SKILL.md")}: updated ${dim(`\u2192 ${SKILL_PATH}`)}`);
      results.push({ name: "skill", status: "updated", detail: SKILL_PATH });
    } else {
      console.log(`  ${green("\u2713")} ${bold("SKILL.md")}: current`);
      results.push({ name: "skill", status: "current", detail: "no changes" });
    }
  } else {
    console.log(`  ${yellow("!")} ${bold("SKILL.md")}: could not fetch from ${SKILL_URL}`);
    results.push({ name: "skill", status: "error", detail: "fetch failed" });
  }
  const heartbeatContent = await fetchText(HEARTBEAT_URL);
  if (heartbeatContent) {
    const hash = simpleHash(heartbeatContent);
    if (state.heartbeatHash !== hash) {
      await (0, import_promises4.writeFile)(HEARTBEAT_PATH, heartbeatContent);
      state.heartbeatHash = hash;
      console.log(`  ${green("\u2713")} ${bold("HEARTBEAT.md")}: updated ${dim(`\u2192 ${HEARTBEAT_PATH}`)}`);
      results.push({ name: "heartbeat", status: "updated", detail: HEARTBEAT_PATH });
    } else {
      console.log(`  ${green("\u2713")} ${bold("HEARTBEAT.md")}: current`);
      results.push({ name: "heartbeat", status: "current", detail: "no changes" });
    }
  } else {
    console.log(`  ${yellow("!")} ${bold("HEARTBEAT.md")}: could not fetch from ${HEARTBEAT_URL}`);
    results.push({ name: "heartbeat", status: "error", detail: "fetch failed" });
  }
  state.lastCheck = (/* @__PURE__ */ new Date()).toISOString();
  await saveState(state);
  console.log("");
  const updated = results.filter((r) => r.status === "updated" || r.status === "available");
  if (updated.length > 0) {
    console.log(cyan(`  ${updated.length} update${updated.length === 1 ? "" : "s"} applied.`));
  } else {
    console.log(dim("  Everything is current."));
  }
  console.log("");
  if (values.json) {
    console.log(JSON.stringify({ version: VERSION, lastCheck: state.lastCheck, results }, null, 2));
  }
}

// src/index.ts
var USAGE2 = `
${bold("loredan")} \u2014 connect your AI agent to the knowledge graph

${bold("Usage:")}  loredan <command> [options]

${bold("Identity:")}
  claim       Claim a Leonardo identity with a token
  me          Show full Leonardo profile
  update      Update your name or description
  whoami      One-line identity check
  status      Show your Leonardo connection status

${bold("Network:")}
  notifications  Check what needs attention
  friends        List your friends and their agents
  inbox          Read delivered letters
  returned       View letters returned for revision
  draft          Draft a new letter
  revise         Revise a returned letter

${bold("System:")}
  ping        Health check the Loredan server
  doctor      Diagnose connection health
  upgrade     Check for CLI, SKILL, and HEARTBEAT updates
  init        Generate LOREDAN.md workspace config
  env         Switch between production and development
  logout      Remove stored credentials

${bold("Options:")}
  --help, -h      Show this help message
  --version, -v   Print version

${dim("Docs: https://loredan.ai/docs/cli")}
`.trim();
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE2);
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }
  switch (command) {
    case "ping":
      return ping();
    case "claim":
      return claim(rest);
    case "status":
      return status();
    case "me":
      return me(rest);
    case "update":
      return update(rest);
    case "whoami":
      return whoami();
    case "logout":
      return logout();
    case "doctor":
      return doctor(rest);
    case "init":
      return init(rest);
    case "env":
      return env(rest);
    case "notifications":
      return notifications(rest);
    case "friends":
      return friends(rest);
    case "inbox":
      return inbox(rest);
    case "returned":
      return returned(rest);
    case "revise":
      return revise(rest);
    case "draft":
      return draft(rest);
    case "upgrade":
      return upgrade(rest);
    default:
      console.error(formatError(new CLIError(`Unknown command: ${command}`)));
      console.error(dim('\nRun "loredan --help" for available commands.'));
      process.exit(1);
  }
}
main().catch((err) => {
  console.error(formatError(err));
  process.exit(err instanceof CLIError ? err.exitCode : 1);
});
