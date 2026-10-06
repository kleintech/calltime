"use client";

import { BellOff, BellRing, Share, SquarePlus } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/toast";
import { Button, Notice } from "@/components/ui";
import { deletePushSubscription, savePushSubscription, sendTestPush } from "../push-actions";

type Env = "server" | "unsupported" | "ios-install" | "ok";

function detectEnv(): Env {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (iOS && !standalone) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}
const noop = () => () => {};

function keyToBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready);
}

/** Notifications on/off for this device, with iPhone Home Screen instructions and a test button. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const env = useSyncExternalStore(noop, detectEnv, () => "server" as Env);
  const [status, setStatus] = useState<"loading" | "on" | "off" | "denied">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (env !== "ok") return;
    let alive = true;
    registration()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!alive) return;
        if (Notification.permission === "denied") setStatus("denied");
        else setStatus(sub ? "on" : "off");
        // Keep the server copy fresh (keys can rotate; account may have changed on this device).
        if (sub) void savePushSubscription(sub.toJSON(), navigator.userAgent);
      })
      .catch(() => alive && setStatus("off"));
    return () => {
      alive = false;
    };
  }, [env]);

  const enable = useCallback(async () => {
    if (!publicKey) return toast("Notifications aren't set up on this server yet.", { tone: "danger" });
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
      const saved = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if ("error" in saved) {
        await sub.unsubscribe();
        setStatus("off");
        toast("This browser's push service isn't supported. Use the calendar feed instead.", { tone: "danger" });
        return;
      }
      setStatus("on");
      toast("Notifications on for this device.", { tone: "success" });
    } catch (e) {
      console.error(e);
      toast("Couldn't turn on notifications. Try again.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
      toast("Notifications off for this device.");
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      const r = await sendTestPush();
      if ("error" in r && r.error) toast(r.error, { tone: "danger" });
      else if ("ok" in r) toast(String(r.ok), { tone: "success" });
    } finally {
      setBusy(false);
    }
  }, []);

  if (env === "server") return <div className="h-24" aria-hidden />;

  if (env === "ios-install") {
    return (
      <div className="space-y-3">
        <p className="text-base">
          On iPhone, notifications work once Calltime is on your Home Screen:
        </p>
        <ol className="space-y-2.5 text-base">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">1</span>
            <span>
              Tap <Share aria-label="Share" className="inline size-5 align-text-bottom text-accent" /> <b>Share</b> in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">2</span>
            <span>
              Choose <SquarePlus aria-hidden className="inline size-5 align-text-bottom text-accent" /> <b>Add to Home Screen</b>.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">3</span>
            <span>
              Open Calltime from the Home Screen icon, come back to <b>Me</b>, and turn notifications on.
            </span>
          </li>
        </ol>
        <p className="text-sm text-muted">Needs iOS 16.4 or newer. Your calendar feed works either way.</p>
      </div>
    );
  }

  if (env === "unsupported") {
    return (
      <Notice>This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari, or use the calendar feed.</Notice>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-base text-muted">
        Get a ping only when <b className="text-ink">your</b> calls change or a rehearsal is cancelled — never for everyone else&apos;s.
      </p>
      {status === "denied" ? (
        <Notice tone="warn">
          Notifications are blocked for Calltime. Allow them in your browser or phone settings, then reload this page.
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "on" ? (
          <>
            <Button type="button" variant="secondary" onClick={disable} disabled={busy}>
              <BellOff /> Turn off on this device
            </Button>
            <Button type="button" variant="ghost" onClick={test} disabled={busy}>
              Send test notification
            </Button>
          </>
        ) : (
          <Button type="button" onClick={enable} disabled={busy || status === "loading" || status === "denied"} className="w-full sm:w-auto">
            <BellRing /> {status === "loading" ? "Checking…" : busy ? "Turning on…" : "Turn on notifications"}
          </Button>
        )}
      </div>
      {status === "on" ? <p className="text-sm text-success">On for this device.</p> : null}
    </div>
  );
}
