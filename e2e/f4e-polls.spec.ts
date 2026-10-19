import { expect, test, type APIResponse, type BrowserContext, type Page, type Request, type Response } from "@playwright/test";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { agePoll, noticesOf, resetLocalDao, runCron, seedPosition } from "./helpers/dao";
import { composer, createInvite, joinAs, messageWith, rpcAs, service, type Actor } from "./helpers/f2c";

// F4e acceptance: polls with a secret vote, in General. A (Verificado, carries CREATE_POLLS) creates them; B, C, D and E
// are plain members. The point of this spec is privacy: across browser contexts nobody ever receives someone else's
// option (DOM and every response the page gets), results appear only after the close and only above the floor (equal ≥ 3
// voters with 0.1 %; weighted ≥ 5 voters with participaciones and whole %, ruling F4e-R3), a vote change is invisible to
// others, and once closed even the voter sees only "Votaste". Closing is deterministic: closes_at is moved into the past
// (agePoll) and the cron is run; no wall-clock waits. Weights come from positions written by the service role
// (seedPosition) on chain 59141. Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const NAMES = { a: "Encuestadora A", b: "Votante B", c: "Votante C", d: "Votante D", e: "Votante E" };
const Q = { equal: "¿Pizza, sushi o tacos?", few: "¿Café o té?", weighted: "¿Ampliamos el fondo?" };
const ONE = 10n ** 18n; // one participación
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The own option as the page receives it: RSC payloads (HTML-inlined, so quotes may come escaped) and server-action replies.
const MY_OPTION_RE = new RegExp(`(?:myOptionId|my_option_id)\\\\*"\\s*:\\s*\\\\*"(${UUID})`, "g");

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

/**
 * Every response a context receives from the app (documents, RSC payloads, server-action replies) and from Supabase
 * (the chat re-reads a poll from the browser: its poll_details replies land here), kept as text.
 *
 * RSC payloads, server-action replies and poll_details are intercepted (context.route): the test fetches each one
 * itself, keeps its body, and only then hands it to the page. Reading them from the response event instead loses
 * bodies the browser drops on a navigation (Chrome frees the buffer), and an unread body is an unchecked one. A body
 * that cannot be fetched or read is recorded and fails the check. Documents and other JSON keep the response event.
 */
type Capture = { bodies: Promise<string>[]; pollDetails: number; unread: string[] };
const captures = new Map<BrowserContext, Capture>();
const ORIGINS = ["http://localhost:3000", process.env.NEXT_PUBLIC_SUPABASE_URL!];
const UNREAD = "<<unread>>";
const isPollDetails = (url: string) => url.includes("/rest/v1/rpc/poll_details");
/** RSC navigations and prefetches, server actions, and the browser's poll_details calls. */
const mustIntercept = (req: Request) => {
  if (req.method() === "OPTIONS") return false;
  const h = req.headers();
  return h["rsc"] === "1" || "next-action" in h || isPollDetails(req.url());
};
function capture(context: BrowserContext) {
  const cap: Capture = { bodies: [], pollDetails: 0, unread: [] };
  captures.set(context, cap);
  void context.route(
    (url) => ORIGINS.some((o) => url.href.startsWith(o)),
    async (route) => {
      const req = route.request();
      if (!mustIntercept(req)) return route.fallback();
      if (isPollDetails(req.url())) cap.pollDetails++;
      let res: APIResponse;
      let body: string;
      try {
        res = await route.fetch();
        body = await res.text();
      } catch (e) {
        cap.unread.push(`${req.method()} ${req.url()}: ${(e as Error).message}`);
        await route.abort().catch(() => {});
        return;
      }
      cap.bodies.push(Promise.resolve(body));
      // The body is already decoded: drop the encoding and length so the page reads it as sent.
      const headers = { ...res.headers() };
      delete headers["content-encoding"];
      delete headers["content-length"];
      await route.fulfill({ status: res.status(), headers, body }).catch(() => {}); // the page may have navigated away
    },
  );
  context.on("response", (r: Response) => {
    if (!ORIGINS.some((o) => r.url().startsWith(o)) || mustIntercept(r.request())) return;
    const type = r.headers()["content-type"] ?? "";
    if (!/text\/html|text\/x-component|text\/plain|application\/(vnd\.pgrst\.object\+)?json/.test(type)) return;
    const url = r.url();
    // A body that never completes would hang the check: after 10 s it counts as unread instead.
    const body = Promise.race([
      r.text().catch(() => UNREAD),
      new Promise<string>((res) => setTimeout(() => res(UNREAD), 10_000)),
    ]).then((text) => {
      if (text !== UNREAD) return text;
      // An RSC body outside the interception (none expected) still must be read.
      if (type.includes("text/x-component")) cap.unread.push(`${type} ${url}`);
      return "";
    });
    cap.bodies.push(body);
  });
}
/** Every captured body since the last reset; fails if a poll_details or RSC body could not be read. */
async function capturedBodies(context: BrowserContext): Promise<string[]> {
  const cap = captures.get(context)!;
  const bodies = await Promise.all(cap.bodies);
  expect(cap.unread, "every poll_details and RSC response was read").toEqual([]);
  return bodies;
}
/** The option ids the context ever received as "its own vote" since the last reset. */
async function ownOptionsSeen(context: BrowserContext): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const body of await capturedBodies(context)) {
    for (const m of body.matchAll(MY_OPTION_RE)) seen.add(m[1]!);
  }
  return seen;
}
/**
 * Sanity for the closed state: the payloads still carry the poll (its iVoted / i_voted field), so an empty "no option
 * seen" result means the option was absent, not that a renamed field slipped past the pattern.
 */
async function expectPollPayloadSeen(context: BrowserContext) {
  const bodies = await capturedBodies(context);
  expect(bodies.some((b) => /(?:iVoted|i_voted)\\*"\s*:\s*(?:true|false)/.test(b)), "a closed poll payload was received").toBe(true);
}
/**
 * Clears what a context captured so far. Open-poll poll_details / RSC responses may still be in flight (a live re-read
 * after the last vote): clearing then would let a late pre-close reply, which legitimately carries the voter's own
 * option, land in the post-close window. So first wait for the page's network to go idle and for the captured bodies
 * to stop growing, and only then clear.
 */
async function resetCapture(x: Actor) {
  const cap = captures.get(x.context)!;
  let seen = -1;
  while (seen !== cap.bodies.length) {
    seen = cap.bodies.length;
    await x.page.waitForLoadState("networkidle");
    await Promise.all(cap.bodies);
    await x.page.waitForTimeout(300); // a request fired by the last response would show up as a new body
  }
  cap.bodies = [];
  cap.pollDetails = 0;
  cap.unread = [];
}

let admin: Actor;
let a: Actor;
let b: Actor;
let c: Actor;
let d: Actor;
let e: Actor;
let generalChannel = "";
const polls: Record<keyof typeof Q, { id: string; options: Record<string, string> }> = {
  equal: { id: "", options: {} },
  few: { id: "", options: {} },
  weighted: { id: "", options: {} },
};

test.beforeAll(async ({ browser }) => {
  await resetLocalDao();
  const adminContext = await browser.newContext({ viewport: desktop });
  trackErrors(adminContext);
  capture(adminContext);
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  const me = await service().from("members").select("id").eq("wallet_address", addressOf(E2E_SUPER_ADMIN_PK)).single<{ id: string }>();
  expect(me.error).toBeNull();
  admin = { context: adminContext, page: await adminContext.newPage(), id: me.data!.id };

  const invite = () => createInvite(admin.page);
  const onContext = (ctx: BrowserContext) => {
    trackErrors(ctx);
    capture(ctx);
  };
  // A holds Verificado (CREATE_POLLS by default); the rest are plain members.
  a = await joinAs(browser, newWalletKey(), await invite(), NAMES.a, "Verificado", onContext);
  b = await joinAs(browser, newWalletKey(), await invite(), NAMES.b, undefined, onContext);
  c = await joinAs(browser, newWalletKey(), await invite(), NAMES.c, undefined, onContext);
  d = await joinAs(browser, newWalletKey(), await invite(), NAMES.d, undefined, onContext);
  e = await joinAs(browser, newWalletKey(), await invite(), NAMES.e, undefined, onContext);
  for (const x of [admin, a, b, c, d, e]) await x.page.setViewportSize(desktop);

  const { data, error } = await service().from("channels").select("id").eq("name", "General").single<{ id: string }>();
  expect(error).toBeNull();
  generalChannel = data!.id;
});

test.afterAll(async () => {
  await resetLocalDao();
  for (const x of [admin, a, b, c, d, e]) await x?.context.close();
});

const card = (page: Page, question: string) => messageWith(page, question);
const results = (page: Page, question: string) => card(page, question).getByRole("list", { name: "Resultados" });
const resultRow = (page: Page, question: string, label: string) =>
  results(page, question).getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });

async function goGeneral(page: Page) {
  await page.goto(`/c/${generalChannel}`);
  await expect(page.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
}

/** A publishes a poll in General with /encuesta; returns its message id and option ids by label. */
async function publishPoll(page: Page, question: string, options: string[], mode: "1 persona, 1 voto" | "Lineal según participación") {
  await goGeneral(page);
  await composer(page).click();
  await composer(page).pressSequentially("/encuesta");
  await page.getByRole("option", { name: /\/encuesta/ }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva encuesta" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Pregunta").fill(question);
  for (let i = 0; i < options.length; i++) {
    if (i >= 2) await dialog.getByRole("button", { name: "Añadir opción" }).click();
    await dialog.getByRole("textbox", { name: `Opción ${i + 1}`, exact: true }).fill(options[i]!);
  }
  await dialog.getByRole("radio", { name: "1 hora" }).check();
  await dialog.getByRole("radio", { name: mode }).check();
  await dialog.getByRole("button", { name: "Publicar encuesta" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, question).getByText("Encuesta", { exact: true })).toBeVisible();
  const id = (await card(page, question).getAttribute("data-message-id"))!;
  expect(id).toBeTruthy();
  const rows = await service().from("poll_options").select("id, label").eq("poll_id", id);
  expect(rows.error).toBeNull();
  const byLabel: Record<string, string> = {};
  for (const r of (rows.data ?? []) as { id: string; label: string }[]) byLabel[r.label] = r.id;
  expect(Object.keys(byLabel).sort()).toEqual([...options].sort());
  return { id, options: byLabel };
}

/** Votes (or changes the vote) from the card and waits for the card to show it. */
async function voteInCard(page: Page, question: string, label: string) {
  const box = card(page, question);
  await box.getByRole("radio", { name: label, exact: true }).click();
  await box.getByRole("button", { name: /^(Votar|Cambiar voto)$/ }).click();
  await expect(box.getByText(`Tu voto: ${label}`, { exact: true })).toBeVisible();
}

const voteAs = async (x: Actor, poll: string, option: string) => {
  const res = await rpcAs(x.context, "cast_poll_vote", { p_poll: poll, p_option: option });
  expect(res.error).toBeNull();
};

type DetailRow = { my_option_id: string | null; i_voted: boolean; results_status: string; results?: unknown; voter_count: number };
async function detailsAs(x: Actor, poll: string): Promise<DetailRow> {
  const res = await rpcAs(x.context, "poll_details", { p_message_ids: [poll] });
  expect(res.error).toBeNull();
  expect(res.data).toHaveLength(1);
  return (res.data as DetailRow[])[0]!;
}

test("1. permission: a Verificado member is offered /encuesta, a plain member is not and create_poll answers forbidden", async () => {
  await goGeneral(a.page);
  await composer(a.page).click();
  await composer(a.page).pressSequentially("/enc");
  await expect(a.page.getByRole("option", { name: /\/encuesta/ })).toBeVisible();
  await composer(a.page).press("Escape");
  await composer(a.page).fill("");

  await goGeneral(b.page);
  await composer(b.page).click();
  await composer(b.page).pressSequentially("/enc");
  await b.page.waitForTimeout(500);
  await expect(b.page.getByRole("option", { name: /\/encuesta/ })).toHaveCount(0);
  await composer(b.page).fill("");

  const direct = await rpcAs(b.context, "create_poll", {
    p_channel: generalChannel,
    p_question: "intento sin permiso",
    p_options: ["Sí", "No"],
    p_closes_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    p_weight_mode: "equal",
  });
  expect(direct.error?.message).toBe("forbidden");
  const { count } = await service().from("polls").select("*", { count: "exact", head: true }).eq("author_id", b.id);
  expect(count).toBe(0);
});

test("2. create, equal: A publishes a 1-hour poll and B's open page shows the card live with 0 votantes", async () => {
  // B already has General open (step 1): the card must arrive without a reload.
  polls.equal = await publishPoll(a.page, Q.equal, ["Pizza", "Sushi", "Tacos"], "1 persona, 1 voto");
  const box = card(b.page, Q.equal);
  await expect(box.getByText("Encuesta", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(box.getByText("0 votantes", { exact: true })).toBeVisible();
  await expect(box.getByText("1 persona, 1 voto", { exact: true })).toBeVisible();
  // The dialog's "1 hora" carries two minutes of margin over the server's one-hour minimum.
  await expect(box.getByText(/^Cierra en (59 min|1 h( [0-2] min)?)$/)).toBeVisible();
  await expect(box.getByText("Aún no has votado.")).toBeVisible();
  await expect(box.getByRole("button", { name: "Votar" })).toBeDisabled();
});

test("3. vote and change: counts move live on a new voter only, nobody gets anyone else's option, no % before the close", async () => {
  const { id, options } = polls.equal;
  for (const x of [c, d]) await goGeneral(x.page);

  await voteInCard(b.page, Q.equal, "Pizza");
  await expect(card(a.page, Q.equal).getByText("1 votante", { exact: true })).toBeVisible({ timeout: 30_000 });

  // The change: B sees it, the count stays at one.
  await voteInCard(b.page, Q.equal, "Sushi");
  await expect(card(b.page, Q.equal).getByText("1 votante", { exact: true })).toBeVisible();
  await expect(card(b.page, Q.equal).getByRole("radio", { name: "Sushi", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(card(b.page, Q.equal).getByRole("button", { name: "Cambiar voto" })).toBeDisabled();

  // A new voter moves A's live count to exactly 2: had the change counted, it would read 3.
  await voteInCard(c.page, Q.equal, "Sushi");
  await expect(card(a.page, Q.equal).getByText("2 votantes", { exact: true })).toBeVisible({ timeout: 30_000 });
  await voteInCard(d.page, Q.equal, "Pizza");
  await expect(card(a.page, Q.equal).getByText("3 votantes", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card(b.page, Q.equal).getByText("3 votantes", { exact: true })).toBeVisible({ timeout: 30_000 });

  // DOM: each voter sees only their own vote; A (no vote) sees none; nobody sees a percentage.
  await expect(card(b.page, Q.equal).getByText("Tu voto: Sushi", { exact: true })).toBeVisible();
  await expect(card(c.page, Q.equal).getByText("Tu voto: Sushi", { exact: true })).toBeVisible();
  await expect(card(d.page, Q.equal).getByText("Tu voto: Pizza", { exact: true })).toBeVisible();
  await expect(card(a.page, Q.equal).getByText("Aún no has votado.")).toBeVisible();
  await expect(card(a.page, Q.equal)).not.toContainText("Tu voto:");
  for (const x of [a, b, c, d]) await expect(card(x.page, Q.equal)).not.toContainText("%");

  // RPC: poll_details gives each caller only their own option; the SuperAdmin and the author get none.
  for (const x of [admin, a]) {
    const row = await detailsAs(x, id);
    expect(row.my_option_id).toBeNull();
    expect(row.i_voted).toBe(false);
    expect(row.voter_count).toBe(3);
    expect(row.results_status).toBe("pending");
    expect(row.results ?? null).toBeNull();
  }
  expect((await detailsAs(b, id)).my_option_id).toBe(options.Sushi);
  expect((await detailsAs(c, id)).my_option_id).toBe(options.Sushi);
  expect((await detailsAs(d, id)).my_option_id).toBe(options.Pizza);

  // The ballots are out of reach even for the service role (Review Focus 1).
  const ballots = await service().schema("private").from("poll_votes").select();
  expect(ballots.error).not.toBeNull();
  expect(ballots.data).toBeNull();

  // Network: every response each page received carried, as "my option", only that member's own choices.
  // The live re-reads went through the browser's poll_details calls, which the capture saw.
  for (const x of [a, b]) expect(captures.get(x.context)!.pollDetails).toBeGreaterThan(0);
  const seenB = await ownOptionsSeen(b.context);
  expect(seenB.has(options.Sushi!), "the capture sees B's own vote").toBe(true);
  expect([...seenB].every((o) => o === options.Pizza || o === options.Sushi)).toBe(true);
  expect([...(await ownOptionsSeen(c.context))]).toEqual([options.Sushi]);
  expect([...(await ownOptionsSeen(d.context))]).toEqual([options.Pizza]);
  expect([...(await ownOptionsSeen(a.context))]).toEqual([]);
  expect([...(await ownOptionsSeen(admin.context))]).toEqual([]);
});

test("4. close and results: once closes_at passes the bars appear with 'Votaste' and no option; the cron notifies the voters", async () => {
  const { id } = polls.equal;
  for (const x of [a, b]) await resetCapture(x);
  await agePoll(id, 60);

  const expectResults = async (page: Page) => {
    const box = card(page, Q.equal);
    await expect(box.getByText("Cerrada", { exact: true })).toBeVisible();
    await expect(resultRow(page, Q.equal, "Sushi")).toContainText("66,7 %");
    await expect(resultRow(page, Q.equal, "Pizza")).toContainText("33,3 %");
    await expect(resultRow(page, Q.equal, "Tacos")).toContainText("0 %");
    await expect(box.getByText("3 votantes · % de los votos", { exact: true })).toBeVisible();
    await expect(box.getByRole("radio")).toHaveCount(0);
    await expect(box).not.toContainText("Tu voto:");
  };
  await b.page.reload();
  await expectResults(b.page);
  await expect(card(b.page, Q.equal).getByText("Votaste", { exact: true })).toBeVisible();
  await a.page.reload();
  await expectResults(a.page);
  await expect(card(a.page, Q.equal).getByText("Votaste", { exact: true })).toHaveCount(0);
  // Closed: the caller's own option is no longer returned either.
  const mine = await detailsAs(b, id);
  expect(mine.my_option_id).toBeNull();
  expect(mine.i_voted).toBe(true);

  await runCron();
  const row = await service().from("polls").select("finalized_at, results_published").eq("message_id", id).single<{ finalized_at: string | null; results_published: boolean | null }>();
  expect(row.error).toBeNull();
  expect(row.data!.finalized_at).not.toBeNull();
  expect(row.data!.results_published).toBe(true);

  // One notice per voter; the author did not vote and gets none.
  for (const x of [b, c, d]) expect(await noticesOf(x.id, "poll_closed")).toBe(1);
  expect(await noticesOf(a.id, "poll_closed")).toBe(0);
  expect(await noticesOf(admin.id, "poll_closed")).toBe(0);
  await b.page.goto("/notifications");
  await expect(b.page.getByText("Se ha cerrado la encuesta en la que votaste en #General")).toHaveCount(1);

  // Unchanged after the cron sealed the ballots.
  await goGeneral(b.page);
  await expectResults(b.page);
  await expect(card(b.page, Q.equal).getByText("Votaste", { exact: true })).toBeVisible();
  expect((await detailsAs(b, id)).my_option_id).toBeNull();
  // Since the close, no page received anyone's option, not even the voter's own, though they did receive the poll.
  expect([...(await ownOptionsSeen(b.context))]).toEqual([]);
  expect([...(await ownOptionsSeen(a.context))]).toEqual([]);
  await expectPollPayloadSeen(b.context);
  await expectPollPayloadSeen(a.context);
});

test("5. insufficient: with 2 voters a closed poll shows no result at all", async () => {
  polls.few = await publishPoll(a.page, Q.few, ["Café", "Té"], "1 persona, 1 voto");
  await voteAs(b, polls.few.id, polls.few.options["Café"]!);
  await voteAs(c, polls.few.id, polls.few.options["Té"]!);
  await agePoll(polls.few.id, 60);

  await goGeneral(b.page);
  const box = card(b.page, Q.few);
  await expect(box.getByText("Muy pocos votos para mostrar los resultados sin revelar quién votó qué.")).toBeVisible();
  await expect(box.getByText("Votaste", { exact: true })).toBeVisible();
  await expect(box.getByText("2 votantes", { exact: true })).toBeVisible();
  await expect(box.getByRole("list", { name: "Resultados" })).toHaveCount(0);
  await expect(box).not.toContainText("%");
  const row = await detailsAs(c, polls.few.id);
  expect(row.results_status).toBe("insufficient");
  expect(row.results ?? null).toBeNull();
  expect(row.my_option_id).toBeNull();
});

test("6. weighted: lineal by participaciones, B (no shares) is told its vote weighs 0, results in whole % of the total weight", async () => {
  // Five voters with participaciones (the weighted floor, F4e-R3) and B with none.
  await seedPosition(a.id, 6n * ONE);
  await seedPosition(admin.id, 6n * ONE);
  await seedPosition(c.id, 3n * ONE);
  await seedPosition(d.id, 1n * ONE);
  await seedPosition(e.id, 4n * ONE);

  polls.weighted = await publishPoll(a.page, Q.weighted, ["Sí", "No"], "Lineal según participación");
  const { id, options } = polls.weighted;
  await expect(card(a.page, Q.weighted).getByText("Ponderada · lineal según participación", { exact: true })).toBeVisible();

  await goGeneral(b.page);
  await expect(card(b.page, Q.weighted).getByText(/^Tu voto pesa 0: en esta encuesta cuentan las participaciones sin bloquear/)).toBeVisible();
  await voteInCard(b.page, Q.weighted, "No");
  await voteInCard(a.page, Q.weighted, "Sí");
  await expect(card(a.page, Q.weighted).getByText("Tu voto pesa según tus participaciones al crear la encuesta.")).toBeVisible();
  await voteAs(admin, id, options["Sí"]!);
  for (const x of [c, d, e]) await voteAs(x, id, options.No!);
  await expect(card(a.page, Q.weighted).getByText("6 votantes", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card(a.page, Q.weighted)).not.toContainText("%");

  for (const x of [a, b]) await resetCapture(x);
  await agePoll(id, 60);
  // Sí = 6 + 6 = 12, No = 3 + 1 + 4 (+ B's 0) = 8, of 20: 60 % and 40 %, whole numbers.
  const expectResults = async (page: Page) => {
    await expect(resultRow(page, Q.weighted, "Sí")).toContainText("60 %");
    await expect(resultRow(page, Q.weighted, "No")).toContainText("40 %");
    await expect(card(page, Q.weighted).getByText("6 votantes · % del peso total", { exact: true })).toBeVisible();
    await expect(results(page, Q.weighted)).not.toContainText(","); // whole % only (F4e-R3)
    await expect(card(page, Q.weighted)).not.toContainText("Tu voto");
  };
  await a.page.reload();
  await expectResults(a.page);
  await b.page.reload();
  await expectResults(b.page);

  await runCron();
  expect(await noticesOf(a.id, "poll_closed")).toBe(1);
  await a.page.reload();
  await expectResults(a.page);
  await expect(card(a.page, Q.weighted).getByText("Votaste", { exact: true })).toBeVisible();
  expect((await detailsAs(a, id)).my_option_id).toBeNull();
  expect([...(await ownOptionsSeen(a.context))]).toEqual([]);
  expect([...(await ownOptionsSeen(b.context))]).toEqual([]);
  await expectPollPayloadSeen(a.context);
  await expectPollPayloadSeen(b.context);
});

test("7. edit and delete: a poll offers no Editar; A deletes the insufficient poll and it leaves B's page live", async () => {
  await goGeneral(a.page);
  await goGeneral(b.page);
  await expect(card(b.page, Q.few)).toBeVisible();

  await card(a.page, Q.few).getByRole("button", { name: "Acciones del mensaje" }).click();
  await expect(a.page.getByRole("menuitem", { name: "Borrar" })).toBeVisible();
  await expect(a.page.getByRole("menuitem", { name: "Editar" })).toHaveCount(0);
  await a.page.getByRole("menuitem", { name: "Borrar" }).click();
  await a.page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(card(a.page, Q.few)).toHaveCount(0);
  await expect(card(b.page, Q.few)).toHaveCount(0, { timeout: 30_000 });

  const left = await service().from("polls").select("message_id").eq("message_id", polls.few.id);
  expect(left.error).toBeNull();
  expect(left.data).toEqual([]);
  const opts = await service().from("poll_options").select("id").eq("poll_id", polls.few.id);
  expect(opts.data).toEqual([]);
});

test("8. no browser errors in any context", () => {
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  expect(browserErrors.filter((e) => !coopOn404(e))).toEqual([]);
});
