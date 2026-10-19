import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { productionEnvProblems } from "@/lib/deploy/readiness";

const root = process.cwd();
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");

/** Keys of a dotenv template (comments and blank lines skipped). */
function envKeys(p: string): string[] {
  return read(p)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.slice(0, l.indexOf("=")));
}

const produccion = read("docs/deploy/produccion.md");
const entornos = read("docs/deploy/entornos.md");

describe("docs/deploy/entornos.md", () => {
  it("lists every key of .env.example and of the production template, plus the build-only variables", () => {
    const keys = new Set([
      ...envKeys(".env.example"),
      ...envKeys("deploy/prod/vercel.env.example"),
      "NEXT_OUTPUT",
      "ENABLE_EXPERIMENTAL_COREPACK",
    ]);
    expect(keys.size).toBeGreaterThan(20);
    for (const k of keys) expect(entornos, k).toContain(`\`${k}\``);
  });

  it("has the MCP section, with what stays manual", () => {
    for (const s of ["MCP", "Vercel MCP", "Supabase MCP", "Cloudflare", "GitHub", "Reown", "Safe", "confirmación"]) {
      expect(entornos, s).toContain(s);
    }
  });
});

describe("docs/deploy/produccion.md", () => {
  it("covers every required topic", () => {
    const required = [
      "fra1",
      "eu-central-1",
      "Web3",
      "Site URL",
      "Redirect URLs",
      "Allow public access",
      "Rate Limits",
      "pg_graphql",
      "sb_publishable_",
      "sb_secret_",
      "deploymentEnabled",
      "vercel deploy --prod",
      "CRON_SECRET",
      "openssl rand -hex 32",
      "SUPER_ADMIN_WALLET",
      "generate-vapid-keys",
      "Reown",
      "elclub.party",
      "2-de-3",
      "db dump",
      "check:rpc",
      "--chain 59144",
      "archive",
      "tx=rollback",
      "/settings/economia",
      "Linea mainnet",
      "NEXT_PUBLIC_LINEA_RPC_URL",
      "ENABLE_EXPERIMENTAL_COREPACK",
      "Production",
      "DNS only",
      "develop",
      "solo tras revisión legal",
      "Comprueba:",
    ];
    for (const s of required) expect(produccion, s).toContain(s);
  });

  it("names every GitHub secret the production workflow reads, and no deploy hook", () => {
    const workflow = read(".github/workflows/production.yml");
    const secrets = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets).toHaveLength(6);
    for (const s of secrets) expect(produccion, s).toContain(`\`${s}\``);
    expect(produccion).not.toMatch(/VERCEL_DEPLOY_HOOK_URL|Deploy Hook/);
    expect(entornos).not.toMatch(/VERCEL_DEPLOY_HOOK_URL|Deploy Hook/);
  });

  it("explains every message the production readiness check can print", () => {
    const worst = productionEnvProblems({
      NEXT_PUBLIC_CHAIN: "lineaSepolia",
      NEXT_PUBLIC_LINEA_RPC_URL: "x",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL: "x",
      NEXT_PUBLIC_SITE_URL: "http://x",
      NEXT_PUBLIC_SUPABASE_URL: "http://x",
      CRON_SECRET: "short",
      SUPER_ADMIN_WALLET: "nope",
      ETH_USD_FEED_ADDRESS_59141: "x",
      WETH_ADDRESS_59141: "x",
      ETH_USD_FEED_ADDRESS_59144: "x",
      WETH_ADDRESS_59144: "x",
      COINGECKO_DISABLED: "1",
      COINGECKO_API_BASE: "x",
      TIP_CONFIRMATIONS: "1",
    });
    expect(worst.length).toBeGreaterThan(15);
    for (const m of worst) expect(produccion, m).toContain(m);
    expect(produccion).toContain("Configuración de producción inválida");
  });
});
