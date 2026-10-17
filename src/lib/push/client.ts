// Browser-side Web Push helpers. Nothing here runs on import and nothing asks for permission by itself:
// `enablePush` is only called from a click handler.
import { savePushSubscriptionAction, deletePushSubscriptionAction } from "@/lib/notifications/actions";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The subscription of this browser, if any (without prompting). */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  return registration ? registration.pushManager.getSubscription() : null;
}

export type EnableResult = "enabled" | "denied" | "error";

/** Registers /sw.js, asks permission (only because the user pressed the button) and subscribes. */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const res = await savePushSubscriptionAction({
      endpoint: json.endpoint ?? "",
      keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    });
    if (res.error) {
      await subscription.unsubscribe().catch(() => false);
      return "error";
    }
    return "enabled";
  } catch {
    return "error";
  }
}

export async function disablePush(): Promise<boolean> {
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return true;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await deletePushSubscriptionAction(endpoint);
    return true;
  } catch {
    return false;
  }
}
