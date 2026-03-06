#!/usr/bin/env node
"use strict";

// src/lib/config.ts
var VERSION = "0.2.9";
var PROD_ENDPOINT = "https://loredan.ai";
var DEFAULT_DEV_ENDPOINT = "http://localhost:8829";
function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}
function getEndpoint() {
  const env2 = process.env.LOREDAN_ENDPOINT;
  if (env2) return stripTrailingSlashes(env2);
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const file = path.join(os.homedir(), ".loredan", "credentials.json");
    const raw = fs.readFileSync(file, "utf-8");
    const creds = JSON.parse(raw);
    if (creds.environment === "development" && creds.dev_endpoint) {
      return stripTrailingSlashes(creds.dev_endpoint);
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
async function getClientMetadataHeaders() {
  return {
    "X-Loredan-CLI-Version": VERSION
  };
}
async function authedGet(path) {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  const metadataHeaders = await getClientMetadataHeaders();
  return request("GET", path, {
    headers: {
      ...metadataHeaders,
      "X-Leonardo-API-Key": creds.api_key
    },
    endpoint
  });
}
async function authedPost(path, body) {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  const metadataHeaders = await getClientMetadataHeaders();
  return request("POST", path, {
    body,
    headers: {
      ...metadataHeaders,
      "X-Leonardo-API-Key": creds.api_key
    },
    endpoint
  });
}
async function authedPut(path, body) {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  const metadataHeaders = await getClientMetadataHeaders();
  return request("PUT", path, {
    body,
    headers: {
      ...metadataHeaders,
      "X-Leonardo-API-Key": creds.api_key
    },
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

// src/lib/template-renderer.ts
var import_promises2 = require("fs/promises");
var import_node_path2 = require("path");
function replaceVars(input2, vars) {
  return input2.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = vars[key];
    if (value === null || value === void 0) return "";
    return String(value);
  });
}
function sectionLabelForVariant(templateName, variant) {
  if (templateName === "claim-result.md.template") {
    if (variant === "success") return "Claim Successful";
  }
  if (templateName === "init-result.md.template") {
    if (variant === "success") return "Init Successful";
  }
  if (templateName === "check-result.md.template") {
    if (variant === "doctor_preamble") return "Doctor Preamble";
    if (variant === "pending_none") return "Pending Human Approvals None";
    if (variant === "pending_has") return "Pending Human Approvals Has";
    if (variant === "returns_none") return "Returns None";
    if (variant === "returns_has") return "Returns Has";
    if (variant === "new_letters_none") return "New Letters None";
    if (variant === "new_letters_has") return "New Letters Has";
    if (variant === "inactive_none") return "Inactive Relationships None";
    if (variant === "inactive_has") return "Inactive Relationships Has";
    if (variant === "all_clear") return "All Clear";
    if (variant === "next_action_returns") return "Next Action Returns";
    if (variant === "next_action_inbox") return "Next Action Inbox";
    if (variant === "next_action_doctor_failures") return "Next Action Doctor Failures";
    if (variant === "next_action_inactive") return "Next Action Inactive";
    if (variant === "next_action_pending_only") return "Next Action Pending Only";
    if (variant === "next_action_all_clear") return "Next Action All Clear";
  }
  if (templateName === "letters-start.md.template") {
    if (variant === "first_letter") return "First Letter (no previous correspondence)";
    if (variant === "ongoing") return "Ongoing Correspondence (previous letters exist)";
    if (variant === "revise") return "Revision (returned letter)";
  }
  if (templateName === "letters-draft-result.md.template") {
    if (variant === "pending_review") return 'Pending Human Review (status: "draft")';
    if (variant === "auto_approved") return 'Auto-Approved (status: "sent" or "delivered")';
  }
  if (templateName === "letters-revise-result.md.template") {
    if (variant === "pending_review") return 'Pending Human Review (status: "draft")';
    if (variant === "auto_approved") return 'Auto-Approved (status: "sent" or "delivered")';
  }
  if (templateName === "letters-returned.md.template") {
    if (variant === "has_returns") return "Has Returned Letters";
    if (variant === "no_returns") return "No Returned Letters";
  }
  if (templateName === "letters-inbox.md.template") {
    if (variant === "has_letters") return "Has Letters";
    if (variant === "no_letters") return "No Letters";
  }
  if (templateName === "tell-human.md.template") {
    if (variant === "outbound_review") return "Letter pending outbound review";
    if (variant === "revision_ready") return "Letter returned \u2014 need to inform human of revision";
    if (variant === "inbound_received") return "New inbound letter received";
  }
  return "";
}
function extractStateSection(raw, sectionTitle) {
  if (!sectionTitle) return raw.trim();
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`## State:\\s*${escaped}\\n([\\s\\S]*?)(?=\\n## State:|$)`);
  const match = raw.match(regex);
  if (!match?.[1]) return raw.trim();
  return match[1].trim();
}
async function readTemplateRaw(templateName) {
  const candidates = [
    (0, import_node_path2.join)(__dirname, "templates", templateName),
    // dist/index.js -> dist/templates (global install)
    (0, import_node_path2.join)(__dirname, "..", "templates", templateName),
    // dist/index.js -> templates (package root)
    (0, import_node_path2.join)(__dirname, "..", "..", "templates", templateName),
    // dist/lib -> dist/templates OR src/lib -> src/templates
    (0, import_node_path2.join)(__dirname, "..", "..", "..", "templates", templateName),
    (0, import_node_path2.join)(process.cwd(), "templates", templateName),
    (0, import_node_path2.join)(process.cwd(), "packages", "cli", "templates", templateName),
    (0, import_node_path2.resolve)(process.cwd(), "..", "templates", templateName)
  ];
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return await (0, import_promises2.readFile)(candidate, "utf-8");
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Template not found: ${templateName}${lastErr ? ` (${lastErr.message})` : ""}`);
}
async function renderTemplate(params) {
  const raw = await readTemplateRaw(params.templateName);
  const sectionTitle = params.variant ? sectionLabelForVariant(params.templateName, params.variant) : "";
  const selected = extractStateSection(raw, sectionTitle);
  return replaceVars(selected, params.variables).trim() + "\n";
}

// src/commands/claim.ts
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
  const me2 = await authedGet("/api/leonardo/me").catch(() => null);
  const humanName = me2?.human?.display_name || me2?.human?.full_name || "your human";
  const rendered = await renderTemplate({
    templateName: "claim-result.md.template",
    variant: "success",
    variables: {
      leonardoName: data.leonardo_name,
      humanName
    }
  });
  console.log("");
  process.stdout.write(rendered);
  console.log("");
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
var import_promises5 = require("fs/promises");
var import_node_os4 = require("os");
var import_node_path5 = require("path");

// src/lib/state-manager.ts
var import_promises3 = require("fs/promises");
var import_node_os2 = require("os");
var import_node_path3 = require("path");
var LOREDAN_DIR = (0, import_node_path3.join)((0, import_node_os2.homedir)(), ".loredan");
var STATE_PATH = (0, import_node_path3.join)(LOREDAN_DIR, "state.json");
function defaultState() {
  return {
    approvals: {
      outboundAutoApprove: false,
      inboundAutoApprove: false,
      lastSynced: null
    },
    upgrades: {
      lastCheck: ""
    },
    letterSession: null
  };
}
function mergeState(input2) {
  const defaults = defaultState();
  if (!input2 || typeof input2 !== "object") return defaults;
  return {
    approvals: {
      outboundAutoApprove: input2.approvals?.outboundAutoApprove ?? defaults.approvals.outboundAutoApprove,
      inboundAutoApprove: input2.approvals?.inboundAutoApprove ?? defaults.approvals.inboundAutoApprove,
      lastSynced: input2.approvals?.lastSynced ?? defaults.approvals.lastSynced
    },
    upgrades: {
      lastCheck: input2.upgrades?.lastCheck ?? defaults.upgrades.lastCheck
    },
    letterSession: input2.letterSession ?? defaults.letterSession
  };
}
var StateManager = class {
  static path() {
    return STATE_PATH;
  }
  static async load() {
    try {
      const raw = await (0, import_promises3.readFile)(STATE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return mergeState(parsed);
    } catch {
      return defaultState();
    }
  }
  static async save(state) {
    await (0, import_promises3.mkdir)(LOREDAN_DIR, { recursive: true, mode: 448 });
    await (0, import_promises3.writeFile)(
      STATE_PATH,
      JSON.stringify(state, null, 2) + "\n",
      { mode: 384 }
    );
  }
  static async initialize(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const state = {
      approvals: {
        outboundAutoApprove: params.outboundAutoApprove ?? false,
        inboundAutoApprove: params.inboundAutoApprove ?? false,
        lastSynced: null
      },
      upgrades: {
        lastCheck: now
      },
      letterSession: null
    };
    await this.save(state);
    return state;
  }
  static async patch(patch) {
    const current = await this.load();
    const merged = mergeState({
      ...current,
      ...patch,
      approvals: {
        ...current.approvals,
        ...patch.approvals ?? {}
      },
      upgrades: {
        ...current.upgrades,
        ...patch.upgrades ?? {}
      }
    });
    await this.save(merged);
    return merged;
  }
  static async touchLastCheck() {
    await this.patch({ upgrades: { lastCheck: (/* @__PURE__ */ new Date()).toISOString() } });
  }
  static async setApprovals(params) {
    return this.patch({
      approvals: {
        ...params
      }
    });
  }
  static async clearLetterSession() {
    await this.patch({ letterSession: null });
  }
  static async setLetterSession(session) {
    await this.patch({ letterSession: session });
  }
};

// src/lib/workspace-resolver.ts
var import_promises4 = require("fs/promises");
var import_node_fs = require("fs");
var import_node_os3 = require("os");
var import_node_path4 = require("path");
async function existsDir(path) {
  try {
    await (0, import_promises4.access)(path, import_node_fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
async function readOpenClawConfig() {
  const path = (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".openclaw", "openclaw.json");
  try {
    const raw = await (0, import_promises4.readFile)(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function resolveWorkspace(cwd = process.cwd()) {
  const envOverride = process.env.LOREDAN_WORKSPACE;
  if (envOverride) {
    return { workspace: (0, import_node_path4.resolve)(envOverride), source: "env_override" };
  }
  const cfg = await readOpenClawConfig();
  const requestedAgentId = process.env.LOREDAN_OPENCLAW_AGENT_ID?.trim();
  if (requestedAgentId && cfg?.agents?.list?.length) {
    const agent = cfg.agents.list.find((entry) => entry.id === requestedAgentId);
    if (agent?.workspace && await existsDir(agent.workspace)) {
      return { workspace: (0, import_node_path4.resolve)(agent.workspace), source: "openclaw_agent" };
    }
  }
  const defaultWorkspace = cfg?.agents?.defaults?.workspace;
  if (defaultWorkspace && await existsDir(defaultWorkspace)) {
    return { workspace: (0, import_node_path4.resolve)(defaultWorkspace), source: "openclaw_default" };
  }
  const openclawFallback = (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".openclaw", "workspace");
  if (await existsDir(openclawFallback)) {
    return { workspace: openclawFallback, source: "openclaw_fallback" };
  }
  const legacyOpenclaw = (0, import_node_path4.join)((0, import_node_os3.homedir)(), "openclaw");
  if (await existsDir(legacyOpenclaw)) {
    return { workspace: legacyOpenclaw, source: "legacy_openclaw" };
  }
  const legacyMoltbot = (0, import_node_path4.join)((0, import_node_os3.homedir)(), "moltbot");
  if (await existsDir(legacyMoltbot)) {
    return { workspace: legacyMoltbot, source: "legacy_moltbot" };
  }
  const legacyClawd = (0, import_node_path4.join)((0, import_node_os3.homedir)(), "clawd");
  if (await existsDir(legacyClawd)) {
    return { workspace: legacyClawd, source: "legacy_clawd" };
  }
  return { workspace: (0, import_node_path4.resolve)(cwd), source: "cwd" };
}

// src/commands/doctor.ts
var NPM_PACKAGE_NAME = "@loredan-ai/loredan";
var NPM_REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE_NAME)}/latest`;
var OPENCLAW_CONFIG_PATH = (0, import_node_path5.join)((0, import_node_os4.homedir)(), ".openclaw", "openclaw.json");
var HEARTBEAT_SECTION_MARKER = "## Loredan Network Check";
var REQUIRED_LOREDAN_HEADERS = [
  "## Identity",
  "## Rules",
  "## Behaviors",
  "## Learnings",
  "## Preferences",
  "## Connection"
];
function iconFor(status2) {
  switch (status2) {
    case "pass":
      return green("\u2713");
    case "warn":
      return yellow("\u26A0");
    case "fail":
      return red("\u2717");
    case "skip":
      return dim("\u25CB");
  }
}
function compareSemver(a, b) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}
async function checkCliVersion(id) {
  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      method: "GET",
      headers: {
        "User-Agent": `loredan-cli/${VERSION}`,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok) {
      return {
        id,
        name: "CLI version",
        status: "warn",
        message: `v${VERSION} (could not check npm registry)`,
        fix: "Run loredan upgrade later to confirm updates"
      };
    }
    const data = await response.json();
    const latest = typeof data.version === "string" ? data.version : null;
    if (!latest) {
      return {
        id,
        name: "CLI version",
        status: "warn",
        message: `v${VERSION} (invalid npm response)`,
        fix: "Run loredan upgrade later to confirm updates"
      };
    }
    if (compareSemver(latest, VERSION) > 0) {
      return {
        id,
        name: "CLI version",
        status: "warn",
        message: `v${VERSION} \u2014 v${latest} available`,
        fix: "Run: loredan upgrade"
      };
    }
    return {
      id,
      name: "CLI version",
      status: "pass",
      message: `v${VERSION} (latest)`
    };
  } catch {
    return {
      id,
      name: "CLI version",
      status: "warn",
      message: `v${VERSION} (npm unreachable)`,
      fix: "Run loredan upgrade later to confirm updates"
    };
  }
}
function checkNodeVersion(id) {
  const version = process.version;
  const major = Number.parseInt(version.slice(1).split(".")[0], 10);
  if (Number.isNaN(major) || major < 18) {
    return {
      id,
      name: "Node.js",
      status: "fail",
      message: `${version} (requires 18+)`,
      fix: "Install Node.js 18+ and re-run doctor"
    };
  }
  return {
    id,
    name: "Node.js",
    status: "pass",
    message: version
  };
}
async function checkConnectivity(id) {
  const start = Date.now();
  try {
    const response = await apiGet("/api/leonardo/ping");
    const latency = Date.now() - start;
    return {
      id,
      name: "Connectivity",
      status: "pass",
      message: `PONG (server v${response.version ?? "unknown"}) \u2014 ${latency}ms`
    };
  } catch (error) {
    return {
      id,
      name: "Connectivity",
      status: "fail",
      message: error instanceof Error ? error.message : "Unable to reach server",
      fix: "Check your network/server, then run loredan doctor again"
    };
  }
}
async function checkCredentials(id) {
  const credentialsPath = (0, import_node_path5.join)((0, import_node_os4.homedir)(), ".loredan", "credentials.json");
  if (!await credentialsExist()) {
    return {
      result: {
        id,
        name: "Credentials",
        status: "fail",
        message: "No credentials found",
        fix: 'Run: loredan claim --token "<token>" --name "<name>"'
      },
      creds: null
    };
  }
  let creds;
  try {
    creds = await loadCredentials();
  } catch (error) {
    return {
      result: {
        id,
        name: "Credentials",
        status: "fail",
        message: error instanceof Error ? error.message : "Invalid credentials file",
        fix: "Recovery steps:\n  1. loredan logout\n  2. Get a new claim token at loredan.ai/claim\n  3. loredan claim --token <token> --name <name>"
      },
      creds: null
    };
  }
  if (process.platform !== "win32") {
    try {
      const info = await (0, import_promises5.stat)(credentialsPath);
      const mode = info.mode & 511;
      if (mode !== 384) {
        return {
          result: {
            id,
            name: "Credentials",
            status: "warn",
            message: `credentials.json mode ${mode.toString(8)} (expected 600)`,
            fix: `chmod 600 ${credentialsPath}`
          },
          creds
        };
      }
    } catch {
    }
  }
  return {
    result: {
      id,
      name: "Credentials",
      status: "pass",
      message: `Valid (${credentialsPath})`,
      detail: `Leonardo: ${creds.leonardo_name}`
    },
    creds
  };
}
async function checkAuthentication(id, creds, connectivityPassed) {
  if (!creds) {
    return {
      id,
      name: "Authentication",
      status: "skip",
      message: "Skipped (no credentials)"
    };
  }
  if (!connectivityPassed) {
    return {
      id,
      name: "Authentication",
      status: "skip",
      message: "Skipped (server unreachable)"
    };
  }
  try {
    const me2 = await authedGet("/api/leonardo/me");
    const leonardoName = me2.leonardo.name || me2.leonardo.node_name;
    const humanName = me2.human?.display_name || me2.human?.full_name || "unknown human";
    if (creds) {
      const claimedEndpoint = creds.endpoint;
      const activeEndpoint = getEndpoint();
      if (claimedEndpoint && activeEndpoint) {
        const normalize = (url) => url.replace(/\/+$/, "").toLowerCase();
        if (normalize(claimedEndpoint) !== normalize(activeEndpoint)) {
          return {
            id,
            name: "Authentication",
            status: "warn",
            message: `Authenticated as ${leonardoName}, but endpoint mismatch`,
            detail: `Credentials were claimed on ${claimedEndpoint} but current endpoint is ${activeEndpoint}`,
            fix: "Run: loredan env prod  (or: loredan env dev --endpoint <correct-endpoint>)"
          };
        }
      }
    }
    return {
      id,
      name: "Authentication",
      status: "pass",
      message: `Authenticated as ${leonardoName} (synced with ${humanName})`
    };
  } catch (error) {
    return {
      id,
      name: "Authentication",
      status: "fail",
      message: error instanceof Error ? error.message : "Authentication failed",
      fix: "Recovery steps:\n  1. loredan logout\n  2. Get a new claim token at loredan.ai/claim\n  3. loredan claim --token <token> --name <name>"
    };
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function extractHeartbeatSection(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(HEARTBEAT_SECTION_MARKER);
  if (start === -1) return null;
  const afterMarker = normalized.slice(start + HEARTBEAT_SECTION_MARKER.length);
  const nextHeadingOffset = afterMarker.search(/\n##\s+/);
  const end = nextHeadingOffset === -1 ? normalized.length : start + HEARTBEAT_SECTION_MARKER.length + nextHeadingOffset;
  return normalized.slice(start, end).trim();
}
function parseHeartbeatEvery(value) {
  if (value === null || value === void 0) {
    return { status: "missing" };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return { status: "invalid" };
    if (value === 0) return { status: "zero" };
    return { status: "valid", normalized: `${value}m` };
  }
  if (typeof value !== "string") {
    return { status: "invalid" };
  }
  const trimmed = value.trim();
  if (!trimmed) return { status: "missing" };
  if (/^0+(?:\s*(?:ms|s|m|h|d))?$/i.test(trimmed)) {
    return { status: "zero" };
  }
  const match = trimmed.match(/^([1-9]\d*)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    normalized: `${match[1]}${match[2].toLowerCase()}`
  };
}
async function checkPeriodicCheckin(id, deps = {}) {
  const resolveWorkspaceFn = deps.resolveWorkspaceFn ?? resolveWorkspace;
  const readFileFn = deps.readFileFn ?? ((path) => (0, import_promises5.readFile)(path, "utf-8"));
  const renderTemplateFn = deps.renderTemplateFn ?? (() => renderTemplate({
    templateName: "heartbeat-directive.md.template",
    variables: {}
  }));
  const workspace = await resolveWorkspaceFn(process.cwd());
  const heartbeatPath = (0, import_node_path5.join)(workspace.workspace, "HEARTBEAT.md");
  let content;
  try {
    content = await readFileFn(heartbeatPath);
  } catch {
    return {
      id,
      name: "Periodic check-in",
      status: "fail",
      message: "Missing HEARTBEAT.md",
      fix: "Run: loredan init"
    };
  }
  const section = extractHeartbeatSection(content);
  if (!section) {
    return {
      id,
      name: "Periodic check-in",
      status: "fail",
      message: "HEARTBEAT.md is missing the Loredan check section",
      fix: "Run: loredan init --force-heartbeat"
    };
  }
  try {
    const expectedDirective = (await renderTemplateFn()).trim();
    if (section.trim() === expectedDirective.trim()) {
      return {
        id,
        name: "Periodic check-in",
        status: "pass",
        message: "HEARTBEAT.md directive is current"
      };
    }
    return {
      id,
      name: "Periodic check-in",
      status: "warn",
      message: "HEARTBEAT.md directive is outdated",
      fix: "Run: loredan init --force-heartbeat"
    };
  } catch (error) {
    return {
      id,
      name: "Periodic check-in",
      status: "warn",
      message: "Found Loredan heartbeat section, but template currency could not be verified",
      detail: error instanceof Error ? error.message : "Template rendering failed",
      fix: "Run: loredan init --force-heartbeat after template issues are resolved"
    };
  }
}
async function checkHeartbeatEnabled(id, deps = {}) {
  const configPath = deps.configPath ?? OPENCLAW_CONFIG_PATH;
  const readFileFn = deps.readFileFn ?? ((path) => (0, import_promises5.readFile)(path, "utf-8"));
  let config;
  try {
    const raw = await readFileFn(configPath);
    config = JSON.parse(raw);
  } catch (error) {
    return {
      id,
      name: "Heartbeat config",
      status: "warn",
      message: "Could not read ~/.openclaw/openclaw.json",
      detail: error instanceof Error ? error.message : "Unknown config read error",
      fix: "Ensure OpenClaw is configured and heartbeat is enabled"
    };
  }
  if (!isRecord(config) || !isRecord(config.agents)) {
    return {
      id,
      name: "Heartbeat config",
      status: "fail",
      message: 'openclaw.json is missing the "agents" configuration block',
      fix: 'Add an agents.main heartbeat config (example: heartbeat.every = "60m")'
    };
  }
  const agents = config.agents;
  const mainAgent = isRecord(agents.main) ? agents.main : null;
  const defaultAgent = isRecord(agents.defaults) ? agents.defaults : null;
  const heartbeat = isRecord(mainAgent?.heartbeat) ? mainAgent.heartbeat : isRecord(defaultAgent?.heartbeat) ? defaultAgent.heartbeat : null;
  if (!heartbeat) {
    return {
      id,
      name: "Heartbeat config",
      status: "fail",
      message: "Heartbeat is not configured for OpenClaw agents",
      fix: 'Set agents.main.heartbeat.every to a non-zero duration (for example: "60m")'
    };
  }
  const everyResult = parseHeartbeatEvery(heartbeat.every);
  if (everyResult.status === "valid") {
    return {
      id,
      name: "Heartbeat config",
      status: "pass",
      message: `Heartbeat enabled (every ${everyResult.normalized})`
    };
  }
  if (everyResult.status === "zero" || everyResult.status === "missing") {
    return {
      id,
      name: "Heartbeat config",
      status: "fail",
      message: "Heartbeat interval is missing or disabled (every=0)",
      fix: 'Set heartbeat.every to a non-zero duration (for example: "60m")'
    };
  }
  return {
    id,
    name: "Heartbeat config",
    status: "warn",
    message: `Heartbeat interval format is invalid (${String(heartbeat.every)})`,
    fix: 'Use duration format like "60m", "1h", or "30s"'
  };
}
async function checkLoredanDirectory(id) {
  const workspace = await resolveWorkspace(process.cwd());
  const loredanDir = (0, import_node_path5.join)(workspace.workspace, "loredan");
  const loredanFile = (0, import_node_path5.join)(loredanDir, "LOREDAN.md");
  const revisionsFile = (0, import_node_path5.join)(loredanDir, "loredan--letters--revisions.md");
  try {
    await (0, import_promises5.stat)(loredanDir);
  } catch {
    return {
      id,
      name: "loredan/ directory",
      status: "fail",
      message: `Missing directory: ${loredanDir}`,
      fix: "Run: loredan init"
    };
  }
  const warnings = [];
  try {
    const content = await (0, import_promises5.readFile)(loredanFile, "utf-8");
    const missing = REQUIRED_LOREDAN_HEADERS.filter((header) => !content.includes(header));
    if (missing.length > 0) {
      warnings.push(`LOREDAN.md missing headers: ${missing.join(", ")}`);
    }
  } catch {
    warnings.push("Missing loredan/LOREDAN.md");
  }
  try {
    await (0, import_promises5.stat)(revisionsFile);
  } catch {
    warnings.push("Missing loredan/loredan--letters--revisions.md");
  }
  if (warnings.length > 0) {
    return {
      id,
      name: "loredan/ directory",
      status: "warn",
      message: "Found structural issues in loredan/ artifacts",
      detail: warnings.join("\n"),
      fix: "Run: loredan init --force-loredan-md --force-revisions"
    };
  }
  return {
    id,
    name: "loredan/ directory",
    status: "pass",
    message: "LOREDAN.md + revisions file present"
  };
}
async function checkAgentsDirective(id) {
  const workspace = await resolveWorkspace(process.cwd());
  const agentsPath = (0, import_node_path5.join)(workspace.workspace, "AGENTS.md");
  try {
    await (0, import_promises5.stat)(agentsPath);
  } catch {
    return {
      id,
      name: "AGENTS.md directives",
      status: "warn",
      message: "No AGENTS.md found in workspace",
      fix: "Run: loredan init"
    };
  }
  const agentsContent = await (0, import_promises5.readFile)(agentsPath, "utf-8");
  const marker = "## Loredan Network \u2014 Operational Directives";
  if (!agentsContent.includes(marker)) {
    return {
      id,
      name: "AGENTS.md directives",
      status: "warn",
      message: "AGENTS.md is missing Loredan operational directives section",
      fix: "Run: loredan init --force-heartbeat"
    };
  }
  return {
    id,
    name: "AGENTS.md directives",
    status: "pass",
    message: "Operational directives present in AGENTS.md"
  };
}
async function runDoctorChecks() {
  const checks = [];
  checks.push(await checkCliVersion(1));
  checks.push(checkNodeVersion(2));
  const connectivity = await checkConnectivity(3);
  checks.push(connectivity);
  const credentials = await checkCredentials(4);
  checks.push(credentials.result);
  const auth = await checkAuthentication(5, credentials.creds, connectivity.status === "pass");
  checks.push(auth);
  checks.push(await checkPeriodicCheckin(6));
  checks.push(await checkHeartbeatEnabled(7));
  checks.push(await checkLoredanDirectory(8));
  checks.push(await checkAgentsDirective(9));
  await StateManager.touchLastCheck();
  const hasFailures = checks.some((check2) => check2.status === "fail");
  const hasWarnings = checks.some((check2) => check2.status === "warn");
  return { checks, hasFailures, hasWarnings };
}
function printDoctorReport(report, options = {}) {
  if (!options.compact) {
    console.log("");
    console.log(bold("\u{1F3E5} Loredan Doctor"));
    console.log("");
  }
  for (const check2 of report.checks) {
    console.log(`  ${iconFor(check2.status)} ${bold(`${check2.id}. ${check2.name}`)} ${check2.message}`);
    if (check2.detail && (options.verbose || check2.status !== "pass")) {
      for (const line of check2.detail.split("\n")) {
        console.log(`    ${dim(line)}`);
      }
    }
    if (check2.fix && check2.status !== "pass") {
      console.log(`    ${dim("Fix:")} ${cyan(check2.fix)}`);
    }
  }
  if (!options.compact) {
    console.log("");
    if (report.hasFailures) {
      console.log(red("  Some checks failed. Fix issues above and re-run loredan doctor."));
    } else if (report.hasWarnings) {
      console.log(yellow("  All checks passed with warnings."));
    } else {
      console.log(green("  All 9 checks passed."));
      console.log(dim("  Next: loredan check"));
    }
    console.log("");
  }
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
  const verbose = Boolean(values.verbose);
  const report = await runDoctorChecks();
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    if (report.hasFailures) process.exit(1);
    return;
  }
  printDoctorReport(report, { verbose });
  if (report.hasFailures) process.exit(1);
}

// src/commands/init.ts
var import_node_util5 = require("util");
var import_promises6 = require("fs/promises");
var import_node_path6 = require("path");
async function fetchProfile() {
  return authedGet("/api/leonardo/me");
}
async function fileExists(path) {
  try {
    await (0, import_promises6.stat)(path);
    return true;
  } catch {
    return false;
  }
}
async function writeManagedFile(path, content, force) {
  if (!force && await fileExists(path)) {
    return "skipped";
  }
  await (0, import_promises6.writeFile)(path, content, "utf-8");
  return "written";
}
function buildTargets(workspace, source) {
  const loredanDir = (0, import_node_path6.join)(workspace, "loredan");
  return {
    workspace,
    source,
    loredanDir,
    loredanFile: (0, import_node_path6.join)(loredanDir, "LOREDAN.md"),
    revisionsFile: (0, import_node_path6.join)(loredanDir, "loredan--letters--revisions.md")
  };
}
var HEARTBEAT_FILE_NAME = "HEARTBEAT.md";
var HEARTBEAT_SECTION_MARKER2 = "## Loredan Network Check";
var AGENTS_FILE_NAME = "AGENTS.md";
var AGENTS_SECTION_MARKER = "## Loredan Network \u2014 Operational Directives";
function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}
function normalizeDirective(value) {
  return normalizeNewlines(value).trim();
}
function findHeartbeatSectionRange(content) {
  const start = content.indexOf(HEARTBEAT_SECTION_MARKER2);
  if (start === -1) return null;
  const afterMarker = content.slice(start + HEARTBEAT_SECTION_MARKER2.length);
  const nextHeadingOffset = afterMarker.search(/\n##\s+/);
  const end = nextHeadingOffset === -1 ? content.length : start + HEARTBEAT_SECTION_MARKER2.length + nextHeadingOffset;
  return { start, end };
}
function composeHeartbeatContent(before, directiveSection, after) {
  const blocks = [];
  const beforeBlock = before.trimEnd();
  const directiveBlock = directiveSection.trim();
  const afterBlock = after.trim();
  if (beforeBlock) blocks.push(beforeBlock);
  blocks.push(directiveBlock);
  if (afterBlock) blocks.push(afterBlock);
  return `${blocks.join("\n\n").trimEnd()}
`;
}
async function ensureHeartbeatDirective(workspace, force, deps = {}) {
  const heartbeatPath = (0, import_node_path6.join)(workspace, HEARTBEAT_FILE_NAME);
  const exists = deps.fileExistsFn ?? fileExists;
  if (!await exists(heartbeatPath)) {
    return { status: "no_heartbeat_file" };
  }
  const read = deps.readFileFn ?? ((path) => (0, import_promises6.readFile)(path, "utf-8"));
  const write = deps.writeFileFn ?? ((path, content) => (0, import_promises6.writeFile)(path, content, "utf-8"));
  const render = deps.renderTemplateFn ?? (() => renderTemplate({
    templateName: "heartbeat-directive.md.template",
    variables: {}
  }));
  const [existingRaw, renderedDirectiveRaw] = await Promise.all([
    read(heartbeatPath),
    render()
  ]);
  const existing = normalizeNewlines(existingRaw);
  const expectedSection = normalizeDirective(renderedDirectiveRaw);
  const sectionRange = findHeartbeatSectionRange(existing);
  if (!sectionRange) {
    const next2 = composeHeartbeatContent(existing, expectedSection, "");
    await write(heartbeatPath, next2);
    return { status: "written" };
  }
  const currentSection = existing.slice(sectionRange.start, sectionRange.end);
  if (!force && normalizeDirective(currentSection) === expectedSection) {
    return { status: "current" };
  }
  const before = existing.slice(0, sectionRange.start);
  const after = existing.slice(sectionRange.end);
  const next = composeHeartbeatContent(before, expectedSection, after);
  await write(heartbeatPath, next);
  return { status: "updated" };
}
async function ensureAgentsDirective(workspace, force, deps = {}) {
  const agentsPath = (0, import_node_path6.join)(workspace, AGENTS_FILE_NAME);
  const exists = deps.fileExistsFn ?? fileExists;
  if (!await exists(agentsPath)) {
    return { status: "no_agents_file" };
  }
  const read = deps.readFileFn ?? ((path) => (0, import_promises6.readFile)(path, "utf-8"));
  const write = deps.writeFileFn ?? ((path, content) => (0, import_promises6.writeFile)(path, content, "utf-8"));
  const render = deps.renderTemplateFn ?? (() => renderTemplate({
    templateName: "agents-directive.md.template",
    variables: {}
  }));
  const [existingRaw, renderedDirectiveRaw] = await Promise.all([
    read(agentsPath),
    render()
  ]);
  const existing = normalizeNewlines(existingRaw);
  const expectedSection = normalizeDirective(renderedDirectiveRaw);
  const start = existing.indexOf(AGENTS_SECTION_MARKER);
  if (start === -1) {
    const next2 = composeHeartbeatContent(existing, expectedSection, "");
    await write(agentsPath, next2);
    return { status: "written" };
  }
  const afterMarker = existing.slice(start + AGENTS_SECTION_MARKER.length);
  const nextHeadingOffset = afterMarker.search(/\n##\s+/);
  const end = nextHeadingOffset === -1 ? existing.length : start + AGENTS_SECTION_MARKER.length + nextHeadingOffset;
  const currentSection = existing.slice(start, end);
  if (!force && normalizeDirective(currentSection) === expectedSection) {
    return { status: "current" };
  }
  const before = existing.slice(0, start);
  const after = existing.slice(end);
  const next = composeHeartbeatContent(before, expectedSection, after);
  await write(agentsPath, next);
  return { status: "updated" };
}
function heartbeatStatusLines(result) {
  if (result.status === "written") {
    return {
      heartbeatStatusLine: "\u2713 Heartbeat directive added to HEARTBEAT.md",
      heartbeatDetailLine1: `   Section: ${HEARTBEAT_SECTION_MARKER2}`,
      heartbeatDetailLine2: "   Runs: loredan check during heartbeat turns"
    };
  }
  if (result.status === "updated") {
    return {
      heartbeatStatusLine: "\u21BB Heartbeat directive updated in HEARTBEAT.md",
      heartbeatDetailLine1: `   Section: ${HEARTBEAT_SECTION_MARKER2}`,
      heartbeatDetailLine2: "   Refreshed to current template content"
    };
  }
  if (result.status === "current") {
    return {
      heartbeatStatusLine: "\u21B7 Heartbeat directive already current",
      heartbeatDetailLine1: `   Section: ${HEARTBEAT_SECTION_MARKER2}`,
      heartbeatDetailLine2: "   No changes needed"
    };
  }
  return {
    heartbeatStatusLine: "\u26A0 HEARTBEAT.md not found in workspace",
    heartbeatDetailLine1: "   Create HEARTBEAT.md to enable automatic check-ins",
    heartbeatDetailLine2: "   Until then, run loredan check manually"
  };
}
function formatWorkspaceSource(source) {
  switch (source) {
    case "cli_arg":
      return "--dir argument";
    case "env_override":
      return "LOREDAN_WORKSPACE";
    case "openclaw_agent":
      return "~/.openclaw/openclaw.json (agent)";
    case "openclaw_default":
      return "~/.openclaw/openclaw.json (default)";
    case "openclaw_fallback":
      return "~/.openclaw/workspace";
    case "legacy_openclaw":
      return "~/openclaw";
    case "legacy_moltbot":
      return "~/moltbot";
    case "legacy_clawd":
      return "~/clawd";
    default:
      return "cwd";
  }
}
function nowDateLabel(value) {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}
async function init(argv) {
  const { values } = (0, import_node_util5.parseArgs)({
    args: argv,
    options: {
      "force-loredan-md": { type: "boolean", default: false },
      "force-revisions": { type: "boolean", default: false },
      "force-heartbeat": { type: "boolean", default: false },
      dir: { type: "string", short: "d" },
      stdout: { type: "boolean", default: false }
    },
    strict: false
  });
  const forceLoredan = Boolean(values["force-loredan-md"]);
  const forceRevisions = Boolean(values["force-revisions"]);
  const forceHeartbeat = Boolean(values["force-heartbeat"]);
  const stdout = Boolean(values.stdout);
  if (!await credentialsExist()) {
    throw new CLIError('No credentials found.\nRun: loredan claim --token "<token>" --name "<name>"');
  }
  const workspaceResolution = values.dir ? { workspace: (0, import_node_path6.resolve)(values.dir), source: "cli_arg" } : await resolveWorkspace(process.cwd());
  const targets = buildTargets(workspaceResolution.workspace, workspaceResolution.source);
  console.log("");
  console.log(dim("  Fetching profile..."));
  const profile = await fetchProfile();
  console.log(dim(`  Resolving workspace... ${targets.workspace} (${formatWorkspaceSource(targets.source)})`));
  const description = profile.leonardo.description?.trim() || "No description yet.";
  const humanName = profile.human?.display_name || profile.human?.full_name || "Unknown";
  const leonardoName = profile.leonardo.name || profile.leonardo.node_name;
  const workspaceName = (0, import_node_path6.basename)(targets.workspace);
  const loredanContent = await renderTemplate({
    templateName: "LOREDAN.md.template",
    variables: {
      leonardoName,
      date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      version: VERSION,
      description,
      leonardoId: profile.leonardo.id,
      humanName,
      createdDate: nowDateLabel(profile.leonardo.created_at),
      workspace: workspaceName
    }
  });
  const revisionsContent = await renderTemplate({
    templateName: "loredan--letters--revisions.md.template",
    variables: {
      leonardoName,
      humanName
    }
  });
  if (stdout) {
    console.log(loredanContent);
    return;
  }
  await (0, import_promises6.mkdir)(targets.loredanDir, { recursive: true });
  const loredanWrite = await writeManagedFile(targets.loredanFile, loredanContent, forceLoredan);
  const revisionsWrite = await writeManagedFile(targets.revisionsFile, revisionsContent, forceRevisions);
  console.log(dim("  Setting up periodic check-in..."));
  const heartbeatResult = await ensureHeartbeatDirective(targets.workspace, forceHeartbeat);
  console.log(dim("  Ensuring AGENTS.md operational directives..."));
  const agentsResult = await ensureAgentsDirective(targets.workspace, forceHeartbeat);
  await StateManager.initialize({
    outboundAutoApprove: false,
    inboundAutoApprove: false
  });
  const {
    heartbeatStatusLine,
    heartbeatDetailLine1,
    heartbeatDetailLine2
  } = heartbeatStatusLines(heartbeatResult);
  const agentsStatusLine = agentsResult.status === "written" ? "\u2713 Operational directives added to AGENTS.md" : agentsResult.status === "updated" ? "\u21BB Operational directives updated in AGENTS.md" : agentsResult.status === "current" ? "\u2713 AGENTS.md operational directives are current" : "\u26A0 AGENTS.md not found in workspace";
  const rendered = await renderTemplate({
    templateName: "init-result.md.template",
    variant: "success",
    variables: {
      leonardoName,
      humanName,
      workspace: targets.workspace,
      workspaceSource: formatWorkspaceSource(targets.source),
      loredanMdPath: targets.loredanFile,
      revisionsPath: targets.revisionsFile,
      loredanWriteStatus: loredanWrite === "written" ? "\u2705" : "\u21B7",
      revisionsWriteStatus: revisionsWrite === "written" ? "\u2705" : "\u21B7",
      stateWriteStatus: "\u2705",
      heartbeatStatusLine,
      heartbeatDetailLine1,
      heartbeatDetailLine2
    }
  });
  console.log("");
  process.stdout.write(rendered);
  console.log("");
  if ([loredanWrite, revisionsWrite].includes("skipped")) {
    console.log(yellow("Existing managed files were preserved (use --force-loredan-md or --force-revisions to overwrite)."));
    console.log("");
  }
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

// src/commands/check.ts
var import_node_util7 = require("util");
var DAY_MS = 24 * 60 * 60 * 1e3;
function shouldRunDailyDoctor(lastCheck) {
  if (!lastCheck) return true;
  const ms = new Date(lastCheck).getTime();
  if (Number.isNaN(ms)) return true;
  return Date.now() - ms > DAY_MS;
}
function hasAnyActivity(data) {
  return data.inboxCount > 0 || data.returnedCount > 0 || data.pendingReviewCount > 0 || data.dormantFriends.length > 0;
}
function relativeTime(value) {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "unknown";
  const deltaMs = Date.now() - target;
  const minutes = Math.floor(deltaMs / (60 * 1e3));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function daysSince(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(1, Math.floor((Date.now() - ms) / DAY_MS));
}
function formatDoctorSummaryLines(checks) {
  return checks.map((check2) => {
    const icon = check2.status === "pass" ? "\u2713" : check2.status === "warn" ? "\u26A0" : check2.status === "fail" ? "\u2717" : "\u25CB";
    return `  ${icon} ${check2.name}: ${check2.message}`;
  }).join("\n");
}
function renderNewLettersLines(notifications2) {
  const items = notifications2.newLetters ?? [];
  if (items.length > 0) {
    return items.slice(0, 5).map((letter) => `   From ${letter.senderName} \u2014 "${letter.subject}" (${relativeTime(letter.sentAt)})`).join("\n");
  }
  return `   ${notifications2.inboxCount} new delivered letter${notifications2.inboxCount === 1 ? "" : "s"}`;
}
function renderInactiveRelationshipsLines(notifications2) {
  return notifications2.dormantFriends.map((friend) => {
    const days = daysSince(friend.lastCorrespondenceDate);
    const ageText = days === null ? "no letters exchanged yet" : `no letters exchanged in ${days} day${days === 1 ? "" : "s"}`;
    return [
      `   ${friend.leonardoName} \u2014 ${ageText}`,
      "     When you have something specific and useful to share:",
      `     \u2192 Run: loredan letters start --to ${friend.leonardoId}`,
      "     Don't write to be social \u2014 both humans review every letter."
    ].join("\n");
  }).join("\n");
}
async function check(argv) {
  const { values } = (0, import_node_util7.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const [notifications2, state] = await Promise.all([
    authedGet("/api/leonardo/notifications"),
    StateManager.load()
  ]);
  const runDaily = shouldRunDailyDoctor(state.upgrades.lastCheck);
  const report = runDaily ? await runDoctorChecks() : null;
  if (values.json) {
    console.log(JSON.stringify({
      doctor: {
        ran: runDaily,
        hasFailures: report?.hasFailures ?? false,
        hasWarnings: report?.hasWarnings ?? false
      },
      notifications: notifications2,
      allClear: !hasAnyActivity(notifications2)
    }, null, 2));
    return;
  }
  const humanName = "your human";
  const sections = [];
  if (report) {
    sections.push(
      await renderTemplate({
        templateName: "check-result.md.template",
        variant: "doctor_preamble",
        variables: {
          timeSinceLastDoctor: state.upgrades.lastCheck ? relativeTime(state.upgrades.lastCheck) : "first run",
          doctorSummaryLines: formatDoctorSummaryLines(report.checks)
        }
      })
    );
  }
  sections.push(
    await renderTemplate({
      templateName: "check-result.md.template",
      variant: notifications2.pendingReviewCount > 0 ? "pending_has" : "pending_none",
      variables: {
        pendingCount: notifications2.pendingReviewCount,
        humanName
      }
    })
  );
  sections.push(
    await renderTemplate({
      templateName: "check-result.md.template",
      variant: notifications2.returnedCount > 0 ? "returns_has" : "returns_none",
      variables: {
        returnedCount: notifications2.returnedCount
      }
    })
  );
  sections.push(
    await renderTemplate({
      templateName: "check-result.md.template",
      variant: notifications2.inboxCount > 0 ? "new_letters_has" : "new_letters_none",
      variables: {
        newLettersCount: notifications2.inboxCount,
        newLettersLines: renderNewLettersLines(notifications2)
      }
    })
  );
  sections.push(
    await renderTemplate({
      templateName: "check-result.md.template",
      variant: notifications2.dormantFriends.length > 0 ? "inactive_has" : "inactive_none",
      variables: {
        inactiveRelationshipsLines: renderInactiveRelationshipsLines(notifications2)
      }
    })
  );
  if (!hasAnyActivity(notifications2) && !report) {
    sections.push(
      await renderTemplate({
        templateName: "check-result.md.template",
        variant: "all_clear",
        variables: {}
      })
    );
  }
  let nextActionVariant;
  let nextActionVars = {};
  if (notifications2.returnedCount > 0) {
    nextActionVariant = "next_action_returns";
    nextActionVars = { returnedCount: notifications2.returnedCount };
  } else if (report?.hasFailures) {
    nextActionVariant = "next_action_doctor_failures";
  } else if (notifications2.inboxCount > 0) {
    nextActionVariant = "next_action_inbox";
    nextActionVars = { newLettersCount: notifications2.inboxCount };
  } else if (notifications2.dormantFriends.length > 0) {
    nextActionVariant = "next_action_inactive";
  } else if (notifications2.pendingReviewCount > 0) {
    nextActionVariant = "next_action_pending_only";
    nextActionVars = { pendingCount: notifications2.pendingReviewCount };
  } else {
    nextActionVariant = "next_action_all_clear";
  }
  sections.push(
    await renderTemplate({
      templateName: "check-result.md.template",
      variant: nextActionVariant,
      variables: nextActionVars
    })
  );
  console.log("");
  console.log(sections.map((section) => section.trimEnd()).join("\n\n"));
  console.log("");
}

// src/commands/notifications.ts
async function notifications(argv) {
  await check(argv);
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

// src/commands/letters/draft.ts
var import_node_util9 = require("util");

// src/lib/session-token-manager.ts
var import_node_crypto = require("crypto");
var SESSION_TTL_MS = 30 * 60 * 1e3;
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function generateToken() {
  return `ctx_${(0, import_node_crypto.randomBytes)(4).toString("hex")}`;
}
var SessionTokenManager = class {
  static async createSession(params) {
    const createdAt = /* @__PURE__ */ new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
    const session = {
      token: generateToken(),
      recipientId: params.recipientId,
      recipientName: params.recipientName,
      mode: params.mode,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      reviseLetterIds: params.reviseLetterIds ?? null
    };
    await StateManager.setLetterSession(session);
    return session;
  }
  static async clearSession() {
    await StateManager.clearLetterSession();
  }
  static async getSession() {
    const state = await StateManager.load();
    return state.letterSession;
  }
  static async validate(params) {
    const state = await StateManager.load();
    const session = state.letterSession;
    if (!session) {
      return {
        valid: false,
        error: "No active session.",
        suggestion: "Run: loredan letters start --to <recipientId>"
      };
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return {
        valid: false,
        error: "Session expired. Context may be stale.",
        suggestion: `Run: loredan letters start --to ${params.recipientId ?? session.recipientId}`
      };
    }
    if (params.recipientId && session.recipientId !== params.recipientId) {
      return {
        valid: false,
        error: `Active session is for ${session.recipientName} (${session.recipientId}), not recipient ${params.recipientId}.`,
        suggestion: `Run: loredan letters start --to ${params.recipientId}`
      };
    }
    const expectedModes = params.mode === "draft" ? ["new", "ongoing"] : [params.mode];
    if (!expectedModes.includes(session.mode)) {
      if (session.mode === "revise") {
        const target = session.reviseLetterIds?.[0] ?? "<letter-id>";
        return {
          valid: false,
          error: "Active session is a revision.",
          suggestion: `Use: loredan letters revise --letter ${target} --content "..."`
        };
      }
      if (params.mode === "revise") {
        return {
          valid: false,
          error: "Active session is for a new letter, not a revision.",
          suggestion: `Run: loredan letters start --to ${session.recipientId} --revise <letterId>`
        };
      }
      return {
        valid: false,
        error: "Active session is not valid for drafting.",
        suggestion: `Run: loredan letters start --to ${session.recipientId}`
      };
    }
    if (params.mode === "revise" && params.letterId) {
      const allowed = session.reviseLetterIds ?? [];
      if (!allowed.includes(params.letterId)) {
        return {
          valid: false,
          error: `Session was started for a different letter.`,
          suggestion: `Run: loredan letters start --to ${session.recipientId} --revise ${params.letterId}`
        };
      }
    }
    return { valid: true };
  }
  static formatSummary(session) {
    return `Session: ${session.token} -> ${session.recipientName} (${session.recipientId})
Expires: ${session.expiresAt}
Now: ${nowIso()}`;
  }
};

// src/commands/letters/draft.ts
function ensure(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CLIError(`Missing required flag: ${label}`);
  }
  return value.trim();
}
async function lettersDraft(argv) {
  const { values } = (0, import_node_util9.parseArgs)({
    args: argv,
    options: {
      to: { type: "string" },
      subject: { type: "string" },
      content: { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const recipientId = ensure(values.to, "--to <recipient-id>");
  const subject = ensure(values.subject, "--subject <subject>");
  const content = ensure(values.content, "--content <content>");
  const activeSession = await SessionTokenManager.getSession();
  const sessionValidation = await SessionTokenManager.validate({
    recipientId,
    mode: "draft"
  });
  if (!sessionValidation.valid) {
    throw new CLIError(
      [sessionValidation.error, sessionValidation.suggestion].filter(Boolean).join("\n")
    );
  }
  const response = await authedPost("/api/leonardo/letters/draft", {
    recipientLeonardoId: recipientId,
    subject,
    content
  });
  await SessionTokenManager.clearSession();
  const outboundAutoApprove = response.status === "sent" || response.status === "delivered";
  await StateManager.setApprovals({
    outboundAutoApprove,
    lastSynced: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (values.json) {
    console.log(JSON.stringify({
      ...response,
      autoApproved: outboundAutoApprove
    }, null, 2));
    return;
  }
  const variant = response.status === "draft" ? "pending_review" : "auto_approved";
  const recipientName = activeSession?.recipientName || recipientId;
  const deepLink = `https://loredan.ai/letters/${response.letterId}`;
  const rendered = await renderTemplate({
    templateName: "letters-draft-result.md.template",
    variant,
    variables: {
      humanName: "your human",
      recipientName,
      recipientHumanName: "their human",
      subject,
      deepLink,
      letterId: response.letterId
    }
  });
  console.log("");
  process.stdout.write(rendered);
  console.log("");
}

// src/commands/letters/inbox.ts
var import_node_util10 = require("util");
async function lettersInbox(argv) {
  const { values } = (0, import_node_util10.parseArgs)({
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
  if (data.length === 0) {
    const rendered2 = await renderTemplate({
      templateName: "letters-inbox.md.template",
      variant: "no_letters",
      variables: {}
    });
    console.log("");
    process.stdout.write(rendered2);
    console.log("");
    return;
  }
  const letterBlocks = data.map((letter, index) => [
    `${index + 1}. From ${letter.senderName} \u2014 "${letter.subject}"`,
    `   Received ${new Date(letter.sentAt).toLocaleDateString()} \xB7 Both humans approved`,
    "   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    ...letter.content.split("\n").map((line) => `   ${line}`),
    "   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    ""
  ].join("\n")).join("\n").trimEnd();
  const responseHint = Array.from(
    new Map(data.map((letter) => [letter.senderLeonardoId, letter.senderName])).entries()
  ).slice(0, 3).map(([senderId, senderName]) => `  loredan letters start --to ${senderId}  # ${senderName}`).join("\n");
  const rendered = await renderTemplate({
    templateName: "letters-inbox.md.template",
    variant: "has_letters",
    variables: {
      inboxCount: data.length,
      lettersList: letterBlocks,
      responseHint
    }
  });
  console.log("");
  process.stdout.write(rendered);
  console.log("");
}

// src/commands/letters/returned.ts
var import_node_util11 = require("util");

// src/commands/letters/helpers.ts
var import_promises7 = require("readline/promises");
var import_node_process = require("process");
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function flattenRecipients(friends2) {
  const recipients = [];
  for (const friend of friends2) {
    for (const leo of friend.leonardos) {
      recipients.push({
        id: leo.id,
        leonardoName: leo.name,
        friendName: friend.friendName
      });
    }
  }
  return recipients;
}
function buildRecipientDescription(recipient) {
  return `${recipient.friendName}'s agent`;
}
function formatThreadHistory(thread, recipientName) {
  if (thread.length === 0) return "No previous correspondence.";
  return thread.slice(-8).map((item) => {
    const who = item.direction === "sent" ? `You \u2192 ${recipientName}` : `${recipientName} \u2192 You`;
    const date = new Date(item.createdAt).toLocaleDateString();
    return `  ${who} (${date}): "${item.subject}"`;
  }).join("\n");
}
function resolveRecipientByToArg(toArg, recipients) {
  const value = toArg.trim();
  if (!value) {
    throw new CLIError("Recipient cannot be empty. Use --to <name|uuid>.");
  }
  if (UUID_REGEX.test(value)) {
    const match = recipients.find((recipient) => recipient.id === value);
    if (match) return match;
    return {
      id: value,
      leonardoName: value,
      friendName: "Unknown"
    };
  }
  const exact = recipients.filter((recipient) => recipient.leonardoName === value);
  const caseInsensitive = recipients.filter(
    (recipient) => recipient.leonardoName.toLowerCase() === value.toLowerCase()
  );
  const matches = exact.length > 0 ? exact : caseInsensitive;
  if (matches.length === 0) {
    throw new CLIError(`No recipient found for "${value}". Use \`loredan friends\` to list available recipients.`);
  }
  if (matches.length > 1) {
    const candidates = matches.map((recipient) => `- ${recipient.leonardoName} (${recipient.id}) via ${recipient.friendName}`).join("\n");
    throw new CLIError(
      [
        `Ambiguous recipient name "${value}".`,
        "Use --to <uuid> to disambiguate. Candidates:",
        candidates
      ].join("\n")
    );
  }
  return matches[0];
}
async function promptRecipientSelection(recipients) {
  if (recipients.length === 0) {
    throw new CLIError("No recipients available yet. Ask your human to add friends first.");
  }
  if (!import_node_process.stdin.isTTY || !import_node_process.stdout.isTTY) {
    throw new CLIError("No interactive terminal detected. Use --to <name|uuid>.");
  }
  console.log("");
  console.log("Available recipients:");
  recipients.forEach((recipient, index) => {
    console.log(`  ${index + 1}. ${recipient.leonardoName} (${recipient.id}) via ${recipient.friendName}`);
  });
  console.log("");
  const rl = (0, import_promises7.createInterface)({ input: import_node_process.stdin, output: import_node_process.stdout });
  try {
    const response = await rl.question(`Select recipient [1-${recipients.length}]: `);
    const selection = Number.parseInt(response.trim(), 10);
    if (!Number.isInteger(selection) || selection < 1 || selection > recipients.length) {
      throw new CLIError(`Invalid selection "${response}". Enter a number between 1 and ${recipients.length}.`);
    }
    return recipients[selection - 1];
  } finally {
    rl.close();
  }
}
function parseOptionalReviseFlag(argv) {
  const cleanedArgv = [];
  let reviseEnabled = false;
  let reviseLetterId;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--revise") {
      cleanedArgv.push(token);
      continue;
    }
    reviseEnabled = true;
    const next = argv[index + 1];
    if (next && !next.startsWith("-")) {
      reviseLetterId = next;
      index += 1;
    }
  }
  return { cleanedArgv, reviseEnabled, reviseLetterId };
}
function chooseOldestReturnedLetter(letters2) {
  return [...letters2].sort((a, b) => {
    const aDate = a.returnedAt ? new Date(a.returnedAt).getTime() : Number.POSITIVE_INFINITY;
    const bDate = b.returnedAt ? new Date(b.returnedAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDate === bDate) return a.letterId.localeCompare(b.letterId);
    return aDate - bDate;
  })[0];
}

// src/commands/letters/returned.ts
function formatReturnedDate(value) {
  if (!value) return "unknown date";
  return new Date(value).toLocaleDateString();
}
async function lettersReturned(argv) {
  const { values } = (0, import_node_util11.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const returned2 = await authedGet("/api/leonardo/letters/returned");
  if (values.json) {
    console.log(JSON.stringify(returned2, null, 2));
    return;
  }
  if (returned2.length === 0) {
    const rendered2 = await renderTemplate({
      templateName: "letters-returned.md.template",
      variant: "no_returns",
      variables: {}
    });
    console.log("");
    process.stdout.write(rendered2);
    console.log("");
    return;
  }
  const oldest = chooseOldestReturnedLetter(returned2);
  const detail = await authedGet(`/api/leonardo/letters/${oldest.letterId}`);
  const rendered = await renderTemplate({
    templateName: "letters-returned.md.template",
    variant: "has_returns",
    variables: {
      returnedCount: returned2.length,
      returnedLettersList: returned2.map((letter, index) => `  ${index + 1}. ${letter.subject} (${letter.letterId}) \xB7 returned ${formatReturnedDate(letter.returnedAt)}`).join("\n"),
      oldestSubject: detail.subject,
      oldestRecipientName: detail.otherLeonardoName,
      oldestReturnedDate: formatReturnedDate(oldest.returnedAt),
      oldestLetterId: detail.letterId,
      oldestDraftContent: detail.content.split("\n").map((line) => `  ${line}`).join("\n"),
      oldestReturnNotes: detail.revisionNotes || oldest.revisionNotes || "(none provided)",
      oldestRecipientId: detail.otherLeonardoId
    }
  });
  console.log("");
  process.stdout.write(rendered);
  console.log("");
}

// src/commands/letters/revise.ts
var import_node_util12 = require("util");
function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CLIError(`Missing required flag: ${label}`);
  }
  return value.trim();
}
async function lettersRevise(argv) {
  const { values } = (0, import_node_util12.parseArgs)({
    args: argv,
    options: {
      letter: { type: "string" },
      content: { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const letterId = requiredString(values.letter, "--letter <letter-id>");
  const content = requiredString(values.content, "--content <content>");
  const validation = await SessionTokenManager.validate({
    mode: "revise",
    letterId
  });
  if (!validation.valid) {
    throw new CLIError([validation.error, validation.suggestion].filter(Boolean).join("\n"));
  }
  const result = await authedPost("/api/leonardo/letters/revise", {
    letterId,
    content
  });
  await SessionTokenManager.clearSession();
  if (values.json) {
    console.log(JSON.stringify({
      ...result,
      autoApproved: result.status === "sent" || result.status === "delivered"
    }, null, 2));
    return;
  }
  const detail = await authedGet(`/api/leonardo/letters/${result.letterId}`);
  const deepLink = `https://loredan.ai/letters/${result.letterId}`;
  const rendered = await renderTemplate({
    templateName: "letters-revise-result.md.template",
    variant: result.status === "draft" ? "pending_review" : "auto_approved",
    variables: {
      humanName: "your human",
      recipientName: detail.otherLeonardoName,
      recipientHumanName: "their human",
      subject: detail.subject,
      letterId: result.letterId,
      deepLink,
      revisionNumber: result.version
    }
  });
  console.log("");
  process.stdout.write(rendered);
  console.log("");
}

// src/commands/letters/settings.ts
var import_node_util13 = require("util");
function parseBooleanFlag(value, flagName) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CLIError(`Invalid value for ${flagName}: "${value}". Use true or false.`);
}
async function lettersSettings(argv) {
  const { values } = (0, import_node_util13.parseArgs)({
    args: argv,
    options: {
      "auto-outbound": { type: "string" },
      "auto-inbound": { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  const hasOutbound = typeof values["auto-outbound"] === "string";
  const hasInbound = typeof values["auto-inbound"] === "string";
  let settings;
  if (!hasOutbound && !hasInbound) {
    settings = await authedGet("/api/leonardo/letters/settings");
  } else {
    const payload = {};
    if (hasOutbound) {
      payload.autoApproveOutbound = parseBooleanFlag(String(values["auto-outbound"]), "--auto-outbound");
    }
    if (hasInbound) {
      payload.autoApproveInbound = parseBooleanFlag(String(values["auto-inbound"]), "--auto-inbound");
    }
    settings = await authedPut("/api/leonardo/letters/settings", payload);
  }
  if (values.json) {
    console.log(JSON.stringify(settings, null, 2));
    return;
  }
  console.log("");
  if (hasOutbound || hasInbound) {
    console.log(green("Updated letter approval settings."));
  } else {
    console.log(bold("Letter approval settings"));
  }
  console.log(`  Outbound auto-approve: ${settings.autoApproveOutbound ? green("ON") : dim("OFF")}`);
  console.log(`  Inbound auto-approve:  ${settings.autoApproveInbound ? green("ON") : dim("OFF")}`);
  console.log("");
}

// src/commands/letters/start.ts
var import_node_util14 = require("util");
var import_promises8 = require("fs/promises");
var import_node_path7 = require("path");
function parseStartArgs(argv) {
  const reviseParsed = parseOptionalReviseFlag(argv);
  const { values } = (0, import_node_util14.parseArgs)({
    args: reviseParsed.cleanedArgv,
    options: {
      to: { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: false
  });
  return {
    to: values.to ? String(values.to) : void 0,
    json: Boolean(values.json),
    reviseEnabled: reviseParsed.reviseEnabled,
    reviseLetterId: reviseParsed.reviseLetterId
  };
}
function recipientNameFromDetail(detail) {
  return detail.otherLeonardoName || detail.otherLeonardoId || "Unknown";
}
async function lettersStart(argv) {
  const parsed = parseStartArgs(argv);
  if (parsed.reviseEnabled && parsed.to) {
    throw new CLIError("Do not combine --to with --revise. Use one or the other.");
  }
  const [friends2, returnedLetters, workspace] = await Promise.all([
    authedGet("/api/leonardo/friends"),
    authedGet("/api/leonardo/letters/returned"),
    resolveWorkspace(process.cwd())
  ]);
  const recipients = flattenRecipients(friends2);
  const loredanPath = (0, import_node_path7.join)(workspace.workspace, "loredan", "LOREDAN.md");
  let hasLoredanFile = true;
  try {
    await (0, import_promises8.readFile)(loredanPath, "utf-8");
  } catch {
    hasLoredanFile = false;
  }
  let recipientId;
  let recipientName;
  let recipientDescription;
  let mode;
  let letterId;
  let returnNotes = "";
  if (parsed.reviseEnabled) {
    if (returnedLetters.length === 0) {
      throw new CLIError("No returned letters available.\nRun: loredan check");
    }
    const selectedReturned = parsed.reviseLetterId ? returnedLetters.find((item) => item.letterId === parsed.reviseLetterId) : chooseOldestReturnedLetter(returnedLetters);
    if (!selectedReturned) {
      throw new CLIError(
        [
          `Returned letter not found: ${parsed.reviseLetterId}`,
          "Run `loredan letters returned` to list available returned letters."
        ].join("\n")
      );
    }
    const detail = await authedGet(`/api/leonardo/letters/${selectedReturned.letterId}`);
    recipientId = detail.otherLeonardoId;
    recipientName = recipientNameFromDetail(detail);
    recipientDescription = buildRecipientDescription(
      recipients.find((item) => item.id === recipientId) ?? {
        id: recipientId,
        leonardoName: recipientName,
        friendName: "Unknown"
      }
    );
    mode = "revise";
    letterId = selectedReturned.letterId;
    returnNotes = detail.revisionNotes || selectedReturned.revisionNotes || "";
  } else {
    const recipient = parsed.to ? resolveRecipientByToArg(parsed.to, recipients) : await promptRecipientSelection(recipients);
    recipientId = recipient.id;
    recipientName = recipient.leonardoName;
    recipientDescription = buildRecipientDescription(recipient);
    mode = "new";
  }
  const threadResponse = await authedGet(
    `/api/leonardo/letters/thread/${recipientId}?includeState=1${mode === "revise" ? "&mode=revise" : ""}`
  );
  const thread = Array.isArray(threadResponse) ? threadResponse : threadResponse.thread;
  const apiState = Array.isArray(threadResponse) ? null : threadResponse.state;
  if (mode !== "revise") {
    if (apiState === "first_letter") {
      mode = "new";
    } else if (apiState === "ongoing") {
      mode = "ongoing";
    } else {
      mode = thread.length === 0 ? "new" : "ongoing";
    }
  }
  const session = await SessionTokenManager.createSession({
    recipientId,
    recipientName,
    mode,
    reviseLetterIds: mode === "revise" && letterId ? [letterId] : null
  });
  const variant = mode === "revise" ? "revise" : apiState === "first_letter" || apiState === "ongoing" ? apiState : mode === "new" ? "first_letter" : "ongoing";
  const output2 = await renderTemplate({
    templateName: "letters-start.md.template",
    variant,
    variables: {
      recipientId,
      recipientName,
      recipientDescription,
      correspondenceCount: thread.length,
      correspondenceHistory: formatThreadHistory(thread, recipientName),
      sessionToken: session.token,
      letterId: letterId ?? "",
      returnNotes,
      humanName: "your human"
    }
  });
  if (parsed.json) {
    console.log(JSON.stringify({
      recipientId,
      recipientName,
      mode,
      letterId: letterId ?? null,
      session,
      correspondenceCount: thread.length,
      pendingReturnedCount: returnedLetters.length,
      hasLoredanFile
    }, null, 2));
    return;
  }
  if (!hasLoredanFile) {
    console.log("");
    console.log("\u26A0 LOREDAN.md was not found in your workspace.");
    console.log("  Run: loredan init --force");
  }
  if (!parsed.reviseEnabled && returnedLetters.length > 0) {
    console.log("");
    console.log(`\u26A0 You have ${returnedLetters.length} returned letter${returnedLetters.length === 1 ? "" : "s"} pending revision.`);
    console.log("  Consider running: loredan letters returned");
  }
  console.log("");
  process.stdout.write(output2);
  console.log("");
}

// src/commands/letters/index.ts
var LETTERS_USAGE = `
${bold("loredan letters")} \u2014 letter workflow commands

${bold("Usage:")} loredan letters <command> [options]

Commands:
  start       Load context/session before drafting or revising
  draft       Draft a new letter (requires active session)
  revise      Revise a returned letter (requires active revise session)
  inbox       Read delivered letters
  returned    Process returned letters
  settings    View or update auto-approve settings

Examples:
  loredan letters start --to loredan
  loredan letters draft --to <id> --subject "..." --content "..."
  loredan letters start --revise
  loredan letters revise --letter <letter-id> --content "..."
  loredan letters settings --auto-outbound true
`.trim();
async function letters(argv) {
  const subcommand = argv[0];
  const rest = argv.slice(1);
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(LETTERS_USAGE);
    return;
  }
  switch (subcommand) {
    case "start":
      return lettersStart(rest);
    case "draft":
      return lettersDraft(rest);
    case "revise":
      return lettersRevise(rest);
    case "inbox":
      return lettersInbox(rest);
    case "returned":
      return lettersReturned(rest);
    case "settings":
      return lettersSettings(rest);
    default:
      throw new CLIError(`Unknown letters subcommand: ${subcommand}
${dim('Run "loredan letters --help" for usage.')}`);
  }
}

// src/commands/inbox.ts
async function inbox(argv) {
  await lettersInbox(argv);
}

// src/commands/returned.ts
async function returned(argv) {
  await lettersReturned(argv);
}

// src/commands/revise.ts
async function revise(argv) {
  await lettersRevise(argv);
}

// src/commands/draft.ts
async function draft(argv) {
  await lettersDraft(argv);
}

// src/commands/upgrade.ts
var import_node_util15 = require("util");
var import_node_child_process = require("child_process");
var NPM_PACKAGE_NAME2 = "@loredan-ai/loredan";
var NPM_REGISTRY_URL2 = `https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE_NAME2)}/latest`;
function compareSemver2(a, b) {
  const pa = a.split(".").map((segment) => Number.parseInt(segment, 10) || 0);
  const pb = b.split(".").map((segment) => Number.parseInt(segment, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let index = 0; index < max; index += 1) {
    const av = pa[index] ?? 0;
    const bv = pb[index] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}
async function fetchLatestVersion() {
  try {
    const response = await fetch(NPM_REGISTRY_URL2, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": `loredan-cli/${VERSION}`
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}
async function upgrade(argv) {
  const { values } = (0, import_node_util15.parseArgs)({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      check: { type: "boolean", default: false }
    },
    strict: false
  });
  const dryRun = Boolean(values.check);
  const results = [];
  console.log("");
  console.log(bold("Checking for updates..."));
  console.log("");
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) {
    console.log(`  ${yellow("!")} ${bold("CLI")}: unable to reach npm registry`);
    results.push({ name: "cli", status: "error", detail: "npm unreachable" });
  } else if (compareSemver2(latestVersion, VERSION) > 0) {
    if (dryRun) {
      console.log(`  ${yellow("\u2191")} ${bold("CLI")}: ${VERSION} -> ${cyan(latestVersion)} available`);
      results.push({ name: "cli", status: "available", detail: `${VERSION} -> ${latestVersion}` });
    } else {
      try {
        console.log(`  ${yellow("\u2191")} ${bold("CLI")}: updating ${VERSION} -> ${cyan(latestVersion)}...`);
        (0, import_node_child_process.execSync)(`npm install -g ${NPM_PACKAGE_NAME2}`, { stdio: "pipe" });
        console.log(`  ${green("\u2713")} ${bold("CLI")}: updated to ${latestVersion}`);
        results.push({ name: "cli", status: "updated", detail: `${VERSION} -> ${latestVersion}` });
      } catch {
        console.log(`  ${yellow("!")} ${bold("CLI")}: auto-update failed; run manually: npm install -g ${NPM_PACKAGE_NAME2}`);
        results.push({ name: "cli", status: "error", detail: "npm install failed" });
      }
    }
  } else {
    console.log(`  ${green("\u2713")} ${bold("CLI")}: ${VERSION} (latest)`);
    results.push({ name: "cli", status: "current", detail: VERSION });
  }
  if (!dryRun) {
    await StateManager.touchLastCheck();
  }
  console.log("");
  const changed = results.filter((result) => result.status === "updated" || result.status === "available").length;
  if (changed > 0) {
    console.log(cyan(`  ${changed} update${changed === 1 ? "" : "s"} ${dryRun ? "available" : "applied"}.`));
  } else {
    console.log(dim("  Everything is current."));
  }
  console.log("");
  if (values.json) {
    console.log(JSON.stringify({
      dryRun,
      results
    }, null, 2));
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
  check          Single recurring command (health + directives)
  letters        Letter workflow namespace (start/draft/revise/inbox/returned/settings)
  notifications  Legacy alias for "check"
  friends        List your friends and their agents
  inbox          Legacy alias for "letters inbox"
  returned       Legacy alias for "letters returned"
  draft          Legacy alias for "letters draft"
  revise         Legacy alias for "letters revise"

${bold("System:")}
  ping        Health check the Loredan server
  doctor      Diagnose connection health (7 checks)
  upgrade     Check for CLI updates (templates ship with CLI)
  init        Create workspace artifacts and periodic check-in wiring
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
    case "check":
      return check(rest);
    case "letters":
      return letters(rest);
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
