import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F5 Task 5 (F5-R7/R8): preproduction on the homelab. Docker image (standalone), compose with web + cron + tunnel,
// the self-hosted develop workflow and the env templates. Text assertions only: nothing here talks to Docker.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const readOrEmpty = (p: string) => (existsSync(join(root, p)) ? read(p) : "");

const compose = readOrEmpty("deploy/preprod/docker-compose.yml");
const tunnel = readOrEmpty("deploy/preprod/cloudflared/config.yml");
const crontab = readOrEmpty("deploy/preprod/cron/crontab");
const dockerfile = readOrEmpty("Dockerfile");
const dockerignore = readOrEmpty(".dockerignore");
const workflow = readOrEmpty(".github/workflows/preproduction.yml");
const preEnv = readOrEmpty("deploy/preprod/web.env.example");
const prodEnv = readOrEmpty("deploy/prod/vercel.env.example");
/** The file without its comment lines, for "must not mention" assertions. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

/** KEY=value pairs of an env file (comments and blank lines skipped). */
function envOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}
const exampleKeys = [...envOf(read(".env.example")).keys()];
const publicKeys = exampleKeys.filter((k) => k.startsWith("NEXT_PUBLIC_"));

/** Text of one service block of the compose file (from "  name:" to the next two-space key or top-level key). */
function service(name: string): string {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  expect(start, `service ${name}`).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // The next service, a top-level key, or the comment block that introduces the next service.
    if (/^ {0,2}([a-z][\w-]*:|#)/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Ingress rules of the tunnel config, each as a small key → value map. */
function ingressRules(): Record<string, string>[] {
  const body = tunnel.slice(tunnel.indexOf("ingress:"));
  const rules: Record<string, string>[] = [];
  for (const line of body.split("\n").slice(1)) {
    const m = /^\s*(-\s+)?([\w-]+):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1]) rules.push({});
    rules[rules.length - 1]![m[2]!] = m[3]!;
  }
  return rules;
}

describe("Dockerfile", () => {
  it("runs as the non-root nextjs user on node 22 bookworm-slim", () => {
    expect(dockerfile).toMatch(/^USER nextjs$/m);
    expect(dockerfile).toMatch(/--uid 1001\b/);
    const froms = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThanOrEqual(3);
    for (const f of froms) expect(f).toMatch(/^node:22-bookworm-slim$|^(deps|build)$/);
  });

  it("takes every NEXT_PUBLIC_* of .env.example as a build arg and no secret", () => {
    const args = [...dockerfile.matchAll(/^ARG (\w+)/gm)].map((m) => m[1]!);
    for (const k of publicKeys) expect(args).toContain(k);
    for (const a of args) {
      if (a.startsWith("NEXT_PUBLIC_")) continue;
      expect(a).not.toMatch(/SERVICE_ROLE|SECRET|PRIVATE|RPC_URL|KEY|TOKEN|PASSWORD/);
    }
  });

  it("builds standalone and fails when a baked public URL is missing or not https", () => {
    expect(dockerfile).toMatch(/NEXT_OUTPUT=standalone/);
    expect(dockerfile).toMatch(/NEXT_TELEMETRY_DISABLED=1/);
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm build");
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SITE_URL"]) {
      expect(dockerfile).toContain(`require_https "${k}" "$${k}"`);
    }
    expect(dockerfile).toMatch(/https:\/\/\?\*\) ;;/);
  });

  // R1: the club login lives at /foro/login (the old /login 308s to the public host, which a healthcheck must not follow).
  it("copies the standalone server, .next/static and public, and checks health on /foro/login", () => {
    expect(dockerfile).toMatch(/\.next\/standalone/);
    expect(dockerfile).toMatch(/\.next\/static\s+\.\/\.next\/static/);
    expect(dockerfile).toMatch(/\/public\s+\.\/public/);
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
    expect(dockerfile).toMatch(/^HEALTHCHECK [^\n]*\\\n\s+CMD node -e .*127\.0\.0\.1:3000\/foro\/login'/m);
    expect(dockerfile).toMatch(/PORT=3000/);
    expect(dockerfile).toMatch(/HOSTNAME=0\.0\.0\.0/);
  });

  it("is LF and .dockerignore keeps env files and dev clutter out of the context", () => {
    expect(dockerfile).not.toContain("\r");
    const ignored = dockerignore.split("\n").map((l) => l.trim());
    // .github too: a CI-only change (e.g. the game workflow) must not rebuild the web image on PRE.
    for (const p of [".env*", "node_modules", ".next", ".git", ".github", "e2e", "tests/*", ".claude", "docs"]) {
      expect(ignored).toContain(p);
    }
    // src/lib/members/handle.ts imports tests/fixtures/handles.json: the build needs it, nothing else from tests/.
    expect(ignored).toContain("!tests/fixtures");
    expect(ignored.some((l) => l.startsWith("!") && l !== "!tests/fixtures")).toBe(false);
  });
});

describe("preproduction compose", () => {
  it("is the elclub-pre project on the external supabase_default network", () => {
    expect(compose).toMatch(/^name: elclub-pre$/m);
    expect(compose).toMatch(/^networks:\n(?: {2}.*\n)*? {2}supabase_default:\n {4}external: true$/m);
  });

  it("web joins supabase_default too, so its server reaches the gateway by container name", () => {
    expect(service("web")).toMatch(/networks:\n {6}- default\n {6}- supabase_default\n/);
  });

  it("publishes only 127.0.0.1 ports and never Kong, Postgres or Studio", () => {
    const ports = [...compose.matchAll(/^\s+-\s+"?([\d.:]+)"?\s*$/gm)].map((m) => m[1]!).filter((p) => p.includes(":"));
    // web (Next) and galaxy (Galaxy Survivor, games/galaxy): both bound to 127.0.0.1 only.
    expect(ports).toEqual(["127.0.0.1:3000:3000", "127.0.0.1:8080:8080"]);
    for (const p of ["8000", "5432", "54323", "6543"]) expect(compose).not.toMatch(new RegExp(`:${p}\\b`));
    expect(service("cron")).not.toContain("ports:");
    expect(service("cloudflared")).not.toContain("ports:");
  });

  it("web builds from the repo root with every NEXT_PUBLIC_* as a build arg and reads secrets only at runtime", () => {
    const web = service("web");
    expect(web).toMatch(/context: \.\.\/\.\./);
    for (const k of publicKeys) expect(web).toContain(`${k}: \${${k}}`);
    expect(web).not.toMatch(/SERVICE_ROLE|CRON_SECRET|VAPID_PRIVATE|(?<!NEXT_PUBLIC_)(BASE|ARBITRUM)_(SEPOLIA_)?RPC_URL/);
    expect(web).toContain("env_file: ${ELCLUB_ENV_FILE:-/opt/elclub/pre/web.env}");
    expect(web).toContain("restart: unless-stopped");
  });

  it("cron is alpine busybox crond that writes the bearer header to a private file at start", () => {
    const cron = service("cron");
    expect(cron).toContain("image: alpine:3.20");
    // Only CRON_SECRET, interpolated from the host env file and required: never the whole web.env (service-role key,
    // VAPID private key, RPC URLs).
    expect(cron).not.toContain("env_file");
    expect(cron).toMatch(/environment:\n\s+CRON_SECRET: \$\{CRON_SECRET:\?[^}]*\}\n/);
    const envLines = cron.slice(cron.indexOf("environment:")).split("\n").slice(1);
    const vars: string[] = [];
    for (const l of envLines) {
      if (!/^ {6}\S/.test(l)) break;
      vars.push(l.trim().split(":")[0]!);
    }
    expect(vars).toEqual(["CRON_SECRET"]);
    expect(cron).toContain("./cron/crontab:/etc/crontabs/root:ro");
    expect(cron).toMatch(/depends_on:/);
    expect(cron).toContain("umask 077");
    // $$ so compose does not interpolate the secret into the container's command line at parse time.
    expect(cron).toContain('"$$CRON_SECRET"');
    const command = cron.slice(cron.indexOf("command:"));
    expect(command).not.toMatch(/[^$]\$CRON_SECRET|\$\{CRON_SECRET/);
    expect(cron).toContain("exec env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin crond -f -l 8");
  });

  it("web and cron drop every capability and cannot gain privileges", () => {
    for (const name of ["web", "cron"]) {
      const s = service(name);
      expect(s, name).toMatch(/security_opt:\n\s+- no-new-privileges:true\n/);
      expect(s, name).toMatch(/cap_drop:\n\s+- ALL\n/);
    }
    // web runs as uid 1001 and needs no capability back; cron may only get back what busybox crond and apk need.
    expect(service("web")).not.toContain("cap_add");
    const cron = service("cron");
    const caps: string[] = [];
    if (cron.includes("cap_add:")) {
      for (const l of cron.slice(cron.indexOf("cap_add:")).split("\n").slice(1)) {
        const m = /^\s+- ([A-Z_]+)$/.exec(l);
        if (!m) break;
        caps.push(m[1]!);
      }
    }
    for (const c of caps) expect(["SETUID", "SETGID", "CHOWN", "FOWNER", "DAC_OVERRIDE"]).toContain(c);
  });

  it("cloudflared is pinned, runs the repo ingress and joins both networks", () => {
    const cf = service("cloudflared");
    expect(cf).toMatch(/image: cloudflare\/cloudflared:\d{4}\.\d+\.\d+$/m);
    expect(cf).toContain("tunnel --config /etc/cloudflared/config.yml run");
    expect(cf).toContain("./cloudflared/config.yml:/etc/cloudflared/config.yml:ro");
    expect(cf).toContain("/opt/elclub/pre/cloudflared/credentials.json:/etc/cloudflared/credentials.json:ro");
    expect(cf).toMatch(/- default\b/);
    expect(cf).toMatch(/- supabase_default\b/);
  });

  it("is committed with LF endings", () => {
    expect(compose).not.toContain("\r");
    expect(tunnel).not.toContain("\r");
  });
});

describe("tunnel ingress", () => {
  it("serves the app on pre.elclub.party keeping the original Host (server actions CSRF check, S14)", () => {
    const rules = ingressRules();
    // Galaxy Survivor's own container takes /galaxy first (outside Next: no login proxy, no forum CSP); the rest is web.
    expect(rules[0]).toEqual({ hostname: "pre.elclub.party", path: "^/galaxy(/|$)", service: "http://galaxy:8080" });
    expect(rules[1]).toEqual({ hostname: "pre.elclub.party", service: "http://web:3000" });
    expect(code(tunnel)).not.toMatch(/httpHostHeader|originServerName/);
  });

  it("sends pre-api to Kong only for auth/rest/realtime/storage and 404s the rest (Studio never exposed)", () => {
    const rules = ingressRules();
    const toKong = rules.filter((r) => r.service?.includes("kong"));
    expect(toKong).toEqual([{ hostname: "pre-api.elclub.party", path: "^/(auth|rest|realtime|storage)/v1/", service: "http://kong:8000" }]);
    const kongAt = rules.indexOf(toKong[0]!);
    expect(rules[kongAt + 1]).toEqual({ hostname: "pre-api.elclub.party", service: "http_status:404" });
    expect(rules[rules.length - 1]).toEqual({ service: "http_status:404" });
    expect(code(tunnel)).not.toMatch(/studio|5432|54323/i);
  });
});

describe("cron crontab", () => {
  it("calls the DAO cron hourly over the compose network, logging only the outcome", () => {
    expect(crontab.endsWith("\n")).toBe(true);
    // No extension, so *.sh/*.yml do not cover it: a CRLF checkout would break busybox crond.
    expect(read(".gitattributes")).toMatch(/^deploy\/preprod\/cron\/crontab text eol=lf$/m);
    expect(crontab).not.toContain("\r");
    const jobs = crontab.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatch(/^0 \* \* \* \* /);
    expect(jobs[0]).toContain("http://web:3000/api/cron/dao");
    expect(jobs[0]).not.toMatch(/\s-v\b|--verbose|--trace|\s-i\b|--include/);
    // The header comes from a 0600 file, so the secret never appears in the process list (ps) or the crontab.
    expect(jobs[0]).not.toContain("$CRON_SECRET");
    expect(jobs[0]).toMatch(/-H @\/\S+/);
    // busybox crond hands the line to sh as is; keep it free of % so no cron flavour reads it as stdin.
    expect(jobs[0]).not.toContain("%");
  });
});

describe("preproduction workflow", () => {
  const steps = () => workflow.slice(workflow.indexOf("steps:"));

  it("triggers on develop and manual dispatch only, never pull requests (self-hosted runner)", () => {
    const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\nconcurrency:"));
    expect(on).toMatch(/branches: \[develop\]/);
    expect(on).toContain("workflow_dispatch");
    expect(code(workflow)).not.toMatch(/pull_request/);
    expect(workflow).toMatch(/runs-on: \[self-hosted, linux, elclub-pre\]/);
    expect(workflow).toContain("environment: preproduction");
  });

  it("serializes runs without cancelling, read-only token", () => {
    expect(workflow).toMatch(/concurrency:\n {2}group: preproduction\n {2}cancel-in-progress: false/);
    expect(workflow).toMatch(/permissions:\n {2}contents: read/);
  });

  it("builds, then migrates, then restarts, then smokes", () => {
    const s = steps();
    const build = s.indexOf("$COMPOSE build web");
    const push = s.indexOf("supabase db push");
    const up = s.indexOf("$COMPOSE up -d --no-build web galaxy cron cloudflared");
    // Bind-mounted single files (crontab, tunnel config) can stay stale after `up -d`: cron and cloudflared are always recreated.
    const recreate = s.indexOf("$COMPOSE up -d --no-build --force-recreate cron cloudflared");
    const smoke = s.indexOf("http://127.0.0.1:3000/foro/login");
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(push);
    expect(push).toBeLessThan(up);
    expect(up).toBeLessThan(recreate);
    expect(recreate).toBeLessThan(smoke);
    expect(s).toContain('supabase db push --db-url "$PREPROD_DB_URL" --yes');
    // The password travels in PGPASSWORD (honoured by the CLI's pgx driver, checked with 2.121.0), never in argv.
    expect(s).toContain("PGPASSWORD: ${{ secrets.PREPROD_DB_PASSWORD }}");
    expect(s).toMatch(/supabase\/setup-cli@v1\n\s+with:\n\s+version: 2\.121\.0/);
    expect(s).toContain("docker image prune -f");
  });

  it("never lets a failed build or migration through to the restart", () => {
    const c = code(workflow);
    expect(c).not.toContain("continue-on-error");
    expect(c).not.toMatch(/\bif:/);
    expect(c).not.toMatch(/\|\|\s*true|;\s*true\b|set \+e/);
  });

  it("uses the host env file for compose and only the PREPROD_DB_URL secret, never echoed", () => {
    expect(workflow).toContain("ELCLUB_ENV_FILE: /opt/elclub/pre/web.env");
    expect(workflow).toContain("COMPOSE: docker compose --env-file /opt/elclub/pre/web.env -f deploy/preprod/docker-compose.yml");
    const names = [...workflow.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(["PREPROD_DB_URL", "PREPROD_DB_PASSWORD"]));
    for (const line of workflow.split("\n")) {
      if (/\becho\b|\bprintenv\b|^\s*(run:\s*)?env\s*$|\bset -x\b|\bcat\b/.test(line)) {
        expect(line).not.toMatch(/secrets\.|PREPROD_DB_URL|PGPASSWORD|ELCLUB_ENV_FILE|web\.env/);
      }
    }
    expect(workflow).not.toContain("\r");
  });
});

describe("env templates", () => {
  it("every template and the Dockerfile declare the multi-network variables and no Linea (P0 Task 3)", () => {
    const needed = ["NEXT_PUBLIC_NETWORK_SET", "NEXT_PUBLIC_BASE_BUILDER_CODE", "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL", "NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL"];
    const envExample = read(".env.example");
    for (const [name, text] of [[".env.example", envExample], ["web.env.example", preEnv], ["vercel.env.example", prodEnv]] as const) {
      for (const k of needed) expect(envOf(text).has(k), `${name} ${k}`).toBe(true);
      expect(text, name).not.toMatch(/linea/i);
    }
    // Never an empty set in a template: an unset one means testnet, which must be a choice, not an accident.
    expect(envOf(envExample).get("NEXT_PUBLIC_NETWORK_SET")).toBe("testnet");
    for (const k of needed) {
      expect(dockerfile, `Dockerfile ARG ${k}`).toContain(`ARG ${k}`);
      expect(dockerfile, `Dockerfile ENV ${k}`).toContain(`${k}=$${k}`);
      expect(service("web"), `compose ${k}`).toContain(`${k}: \${${k}}`);
    }
    expect(dockerfile).not.toMatch(/linea/i);
    expect(compose).not.toMatch(/linea/i);
  });

  it("no secret is NEXT_PUBLIC_ in any template", () => {
    for (const text of [read(".env.example"), preEnv, prodEnv]) {
      for (const k of envOf(text).keys()) {
        if (k.startsWith("NEXT_PUBLIC_")) expect(k).not.toMatch(/SERVICE_ROLE|SECRET|PRIVATE|(?<!BASE_SEPOLIA|ARBITRUM_SEPOLIA)_RPC_URL$/);
      }
    }
  });

  it("web.env.example has every key of .env.example, preproduction values only", () => {
    const env = envOf(preEnv);
    for (const k of exampleKeys) expect(env.has(k), k).toBe(true);
    expect(preEnv).not.toContain("supabase.co");
    expect(env.get("NEXT_PUBLIC_SUPABASE_URL")).toBe("https://pre-api.elclub.party");
    expect(env.get("NEXT_PUBLIC_SITE_URL")).toBe("https://pre.elclub.party");
    expect(env.get("NEXT_PUBLIC_NETWORK_SET")).toBe("testnet");
    expect(env.get("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL")).toBe("");
    expect(env.get("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL")).toBe("");
    expect(env.has("NEXT_PUBLIC_BASE_BUILDER_CODE")).toBe(true);
    // An empty TIP_CONFIRMATIONS is invalid for defaultConfirmations and logs a console.error: set the default.
    expect(env.get("TIP_CONFIRMATIONS")).toBe("3");
    // The server talks to Supabase over the Docker network (fix/pre-supabase-red-interna).
    expect(env.get("SUPABASE_INTERNAL_URL")).toBe("http://kong:8000");
    // Behind the Cloudflare tunnel the caller's IP comes in cf-connecting-ip (P4-R6).
    expect(env.get("TRUSTED_IP_HEADER")).toBe("cf-connecting-ip");
    // x402 stays off in every template (D17).
    expect(env.get("X402_ENABLED")).toBe("");
    for (const [k, v] of env) {
      if (!["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_NETWORK_SET", "TIP_CONFIRMATIONS", "SUPABASE_INTERNAL_URL", "TRUSTED_IP_HEADER"].includes(k)) {
        expect(v, k).toBe("");
      }
    }
  });

  it("vercel.env.example has the production keys, no test overrides and corepack on", () => {
    const env = envOf(prodEnv);
    const overrides = ["ETH_USD_FEED_ADDRESS_59141", "WETH_ADDRESS_59141", "COINGECKO_DISABLED", "COINGECKO_API_BASE"];
    for (const k of exampleKeys.filter((k) => !overrides.includes(k))) expect(env.has(k), k).toBe(true);
    for (const k of overrides) expect(env.has(k), k).toBe(false);
    expect(env.get("NEXT_PUBLIC_SITE_URL")).toBe("https://elclub.party");
    expect(env.get("NEXT_PUBLIC_NETWORK_SET")).toBe("mainnet");
    expect(env.get("NEXT_PUBLIC_SUPABASE_URL")).toBe("https://<ref>.supabase.co");
    expect(env.get("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL")).toBe("");
    expect(env.get("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL")).toBe("");
    expect(env.has("NEXT_PUBLIC_BASE_BUILDER_CODE")).toBe(true);
    expect(env.get("ENABLE_EXPERIMENTAL_COREPACK")).toBe("1");
    expect(env.get("TIP_CONFIRMATIONS")).toBe("3");
    expect(env.get("SUPABASE_INTERNAL_URL")).toBe("");
    expect(prodEnv).not.toContain("pre.elclub.party");
    expect(prodEnv).not.toContain("pre-api");
  });
});
