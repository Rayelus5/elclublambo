import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { addressOf, loginAs } from "./auth";

/** Service-role client for test setup and read-only assertions on rows the UI cannot show. */
export const service = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function createInvite(page: Page): Promise<string> {
  await page.goto("/invites");
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const url = await page.getByLabel("Tu enlace de invitación").inputValue();
  return url.split("/invite/")[1]!;
}

export interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
}

/**
 * Logs a generated test wallet in (joining through `invite`), gives it a unique display name and optionally a role.
 * Returns the browser context, a page and the member id.
 */
export async function joinAs(
  browser: Browser,
  pk: `0x${string}`,
  invite: string,
  name: string,
  role?: string,
  onContext?: (context: BrowserContext) => void,
): Promise<Actor> {
  const context = await browser.newContext();
  onContext?.(context);
  await loginAs(context, pk, { invite });
  const page = await context.newPage();
  const db = service();
  const member = await db
    .from("members")
    .update({ display_name: name })
    .eq("wallet_address", addressOf(pk))
    .select("id")
    .single<{ id: string }>();
  expect(member.error).toBeNull();
  if (role) {
    const r = await db.from("roles").select("id").eq("name", role).single<{ id: string }>();
    expect(r.error).toBeNull();
    const grant = await db.from("member_roles").insert({ member_id: member.data!.id, role_id: r.data!.id });
    expect(grant.error).toBeNull();
  }
  return { context, page, id: member.data!.id };
}

export async function channelIds(): Promise<Record<string, string>> {
  const { data } = await service().from("channels").select("id, name");
  const ids: Record<string, string> = {};
  for (const c of (data ?? []) as Array<{ id: string; name: string }>) ids[c.name] = c.id;
  return ids;
}

export const channelsNav = (page: Page) => page.getByRole("navigation", { name: "Canales" });
export const openChannel = async (page: Page, name: string) => {
  await channelsNav(page).getByRole("link", { name: new RegExp(`^${name}( sin leer)?$`) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
};
export const composer = (page: Page) => page.getByRole("textbox", { name: "Mensaje", exact: true });
export const send = async (page: Page, text: string) => {
  await composer(page).click();
  await composer(page).fill(text);
  await composer(page).press("Enter");
};
export const messageWith = (page: Page, text: string) => page.locator("li[data-message-id]", { hasText: text }).first();

/** Sends a message that starts with an @mention picked from the suggestion list. */
export async function sendMention(page: Page, name: string, rest: string) {
  const box = composer(page);
  await box.click();
  await box.fill("");
  await box.pressSequentially(`@${name}`);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await box.pressSequentially(rest);
  await box.press("Enter");
}

/** Calls an RPC with the session of a browser context (its auth cookies), exactly as the app's server actions do. */
export async function rpcAs(context: BrowserContext, fn: string, args: Record<string, unknown>) {
  const jar = (await context.cookies()).map((c) => ({ name: c.name, value: c.value }));
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => jar, setAll: () => {} },
  });
  return supabase.rpc(fn, args);
}

/** The bell link with its accessible name ("Notificaciones" or "Notificaciones, N sin leer"). */
export const bell = (page: Page, unread: number) =>
  page.getByRole("link", { name: unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones", exact: true });
