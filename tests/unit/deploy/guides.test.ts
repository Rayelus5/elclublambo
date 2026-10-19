import { existsSync, readdirSync, readFileSync } from "node:fs";
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
      "dub1",
      "eu-west-1",
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

  it("makes the production Environment branch rule mandatory and creates develop after the F5 merge", () => {
    expect(produccion).toContain("**Obligatorio:** en **Deployment branches and tags**");
    expect(produccion).not.toContain("Opcional, recomendado: en **Deployment branches");
    expect(produccion).toContain("### 7.4 Crear `develop` (después del merge)");
    expect(produccion).not.toContain("### 5.1 Rama `develop`");
  });

  it("keeps the local checkout unlinked, secrets out of shell history, and states the backward-compatible migrations rule", () => {
    expect(produccion).toContain("supabase unlink");
    expect(produccion).toContain("supabase/.temp/project-ref");
    expect(produccion).not.toContain("-MaskInput");
    expect(produccion).toContain("Read-Host -AsSecureString");
    expect(produccion).toContain("[System.Net.NetworkCredential]::new('', $s).Password");
    expect(produccion).toContain("VERCEL_ENV is missing");
    expect(produccion).toContain("`ETH_USD_FEED_ADDRESS_59141` con cualquier valor");
    expect(produccion).toContain("Ignored Build Step");
    expect(produccion).toContain("read -rs SUPABASE_DB_PASSWORD");
    expect(produccion).toContain("Docker Desktop");
    expect(produccion).not.toMatch(/--db-url "\$URL"/);
    expect(produccion).toContain("Migraciones compatibles hacia atrás");
    expect(produccion).toContain("Automatically expose System Environment Variables");
  });

  it("carries no stale migration count and no names of the owner's other projects", () => {
    expect(produccion).not.toMatch(/\d+ migraciones/);
    expect(produccion).not.toMatch(/rai-music-web|ttrpg-manager|arandor/);
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

const homelab = read("docs/deploy/preproduccion-homelab.md");

describe("docs/deploy/preproduccion-homelab.md", () => {
  it("has every required section, in order", () => {
    const sections = [
      "## Contexto para la IA operadora",
      "## 1. Máquina en Proxmox",
      "## 2. Docker",
      "## 3. Supabase self-hosted",
      "## 4. Arrancar Supabase",
      "## 5. Realtime solo privado",
      "## 6. Studio",
      "## 7. Entorno de la web",
      "## 8. Cloudflare Tunnel",
      "## 9. Runner de GitHub",
      "## 10. Primer despliegue",
      "## 11. Mantenimiento",
      "## 12. Solución de problemas",
      "## 13. Checklist final",
    ];
    let last = -1;
    for (const s of sections) {
      const at = homelab.indexOf(`\n${s}`);
      expect(at, s).toBeGreaterThan(last);
      last = at;
    }
  });

  it("covers every required topic", () => {
    const required = [
      "pre.elclub.party",
      "pre-api.elclub.party",
      "supabase_default",
      "elclub-pre",
      "GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED",
      "GOTRUE_RATE_LIMIT_WEB3",
      "DISABLE_SIGNUP=false",
      "API_EXTERNAL_URL=https://pre-api.elclub.party",
      "SITE_URL=https://pre.elclub.party",
      "ADDITIONAL_REDIRECT_URLS",
      "127.0.0.1",
      "cloudflared tunnel ingress rule",
      "http_status:404",
      "65532",
      "UUID",
      "WAF",
      "private_only",
      "pg_dump",
      "select version()",
      "major_version",
      "check:rpc",
      "--chain 59141",
      "/settings/economia",
      "SUPER_ADMIN_WALLET",
      "/opt/elclub/pre/web.env",
      "/opt/elclub/pre/cloudflared/credentials.json",
      "/opt/supabase/docker",
      "ssh -L 8000:127.0.0.1:8000",
      "Reown",
      "elclub dev/pre",
      "lineaSepolia",
      "max-size",
      "unattended-upgrades",
      "Comprueba:",
      "Necesita al humano",
      "produccion.md",
      "entornos.md",
    ];
    for (const s of required) expect(homelab, s).toContain(s);
  });

  it("names every key of the preproduction env templates", () => {
    const dir = join(root, "deploy/preprod");
    const templates = readdirSync(dir).filter((f) => f.endsWith(".env.example"));
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      const keys = envKeys(`deploy/preprod/${t}`);
      expect(keys.length).toBeGreaterThan(20);
      for (const k of keys) expect(homelab, `${t}: ${k}`).toContain(`\`${k}\``);
    }
  });

  it("names every secret and the runner labels of the preproduction workflow, and no deploy hook", () => {
    const workflow = read(".github/workflows/preproduction.yml");
    const secrets = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets).toEqual(["PREPROD_DB_URL", "PREPROD_DB_PASSWORD"]);
    for (const s of secrets) expect(homelab, s).toContain(`\`${s}\``);
    expect(homelab).toContain("PGPASSWORD");
    const labels = /runs-on: \[([^\]]+)\]/.exec(workflow)?.[1];
    expect(labels).toBeTruthy();
    expect(homelab).toContain(labels!.replace(/\s/g, ""));
    expect(homelab).not.toMatch(/deploy hook|VERCEL_DEPLOY_HOOK_URL/i);
  });

  it("sets the client-IP header for GoTrue behind the tunnel and re-checks private_only after the restart", () => {
    expect(homelab).toContain('GOTRUE_RATE_LIMIT_HEADER: "CF-Connecting-IP"');
    const sec5 = homelab.slice(homelab.indexOf("\n## 5. Realtime solo privado"), homelab.indexOf("\n## 6. Studio"));
    const restart = sec5.indexOf("docker compose restart realtime");
    const check = sec5.lastIndexOf("select external_id, private_only");
    expect(restart).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(restart);
    expect(sec5.indexOf("select external_id, private_only")).toBe(check);
  });

  it("never exposes Studio, Postgres or a published port beyond loopback", () => {
    expect(homelab).not.toMatch(/studio\.[\w.-]*elclub\.party|pre-studio|hostname:\s*\S*studio/i);
    expect(homelab).not.toMatch(/0\.0\.0\.0:\d+/);
    expect(homelab).not.toMatch(/service:\s*http:\/\/studio/i);
    expect(homelab).toMatch(/Studio[^\n]*nunca/i);
  });

  it("covers the troubleshooting cases", () => {
    const trouble = homelab.slice(homelab.indexOf("## 12. Solución de problemas"));
    for (const s of ["502", "Kong", "404", "CSP", "NEXT_PUBLIC_SUPABASE_URL", "401", "Offline", "migrate"]) {
      expect(trouble, s).toContain(s);
    }
  });
});
