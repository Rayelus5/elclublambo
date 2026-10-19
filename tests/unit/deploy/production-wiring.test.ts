import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const workflow = read(".github/workflows/production.yml");

/** Text of one top-level job block (from "  name:" to the next two-space key). */
function job(name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  expect(start).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z][\w-]*:/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("vercel.json", () => {
  it("pins region, no git deployments and the hourly cron", () => {
    expect(JSON.parse(read("vercel.json"))).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: "nextjs",
      regions: ["fra1"],
      git: { deploymentEnabled: false },
      crons: [{ path: "/api/cron/dao", schedule: "0 * * * *" }],
    });
  });
});

describe("production workflow", () => {
  it("triggers on main and manual dispatch only, never on pull requests", () => {
    const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\nconcurrency:"));
    expect(on).toMatch(/branches: \[main\]/);
    expect(on).toContain("workflow_dispatch");
    expect(workflow).not.toContain("pull_request");
  });

  it("serializes runs without cancelling a running deploy, read-only token", () => {
    expect(workflow).toMatch(/concurrency:\n {2}group: production\n {2}cancel-in-progress: false/);
    expect(workflow).toMatch(/permissions:\n {2}contents: read/);
  });

  it("runs verify, then migrate, then deploy in strict sequence", () => {
    expect(job("migrate")).toMatch(/needs: verify\b/);
    expect(job("deploy")).toMatch(/needs: migrate\b/);
    expect(job("verify")).not.toContain("needs:");
    expect(job("migrate")).toContain("environment: production");
    expect(job("deploy")).toContain("environment: production");
  });

  it("verify runs the frozen install, typecheck, lint and unit tests", () => {
    const v = job("verify");
    for (const cmd of ["pnpm install --frozen-lockfile", "pnpm typecheck", "pnpm lint", "pnpm test:unit"]) {
      expect(v).toContain(cmd);
    }
    expect(v).toContain("node-version: 22");
  });

  it("migrates before it calls the deploy hook, non-interactively", () => {
    expect(workflow).toContain("supabase db push --yes");
    expect(workflow.indexOf("db push")).toBeLessThan(workflow.indexOf("VERCEL_DEPLOY_HOOK_URL"));
    expect(job("migrate")).not.toContain("VERCEL_DEPLOY_HOOK_URL");
    expect(job("deploy")).toContain('curl -fsS -X POST "$VERCEL_DEPLOY_HOOK_URL"');
  });

  it("only references the four expected secrets", () => {
    const names = [...workflow.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(
      new Set(["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF", "VERCEL_DEPLOY_HOOK_URL"]),
    );
  });

  it("never echoes or prints a secret or the secret-backed env vars", () => {
    for (const line of workflow.split("\n")) {
      if (/\becho\b|\bprintenv\b|\benv\b\s*$|\bset -x\b/.test(line)) {
        expect(line).not.toMatch(/secrets\.|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SUPABASE_PROJECT_REF|VERCEL_DEPLOY_HOOK_URL/);
      }
    }
  });

  it("is committed with LF endings", () => {
    expect(workflow).not.toContain("\r");
    expect(read(".gitattributes")).toMatch(/^\*\.yml text eol=lf$/m);
  });
});
