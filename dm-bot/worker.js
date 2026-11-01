// RUTH RITUALS - Instagram DM/comment bot (Cloudflare Worker, free tier).
// Official Instagram API with Instagram Login. No browser automation.
// Secrets (wrangler secret put): IG_TOKEN, APP_SECRET, VERIFY_TOKEN. Var: IG_USER_ID.
// DRY_RUN=1 -> logs what it would send, sends nothing.
import CONFIG from "./config.json";

const API = "https://graph.instagram.com/v24.0";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname !== "/webhook") return new Response("ok");

    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === env.VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge"))
                : new Response("forbidden", { status: 403 });
    }

    if (req.method !== "POST") return new Response("no", { status: 405 });
    const raw = await req.text();
    if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"), env.APP_SECRET))) {
      return new Response("bad signature", { status: 401 });
    }
    // Answer Meta at once; do the work in the background.
    ctx.waitUntil(handle(JSON.parse(raw), env).catch(e => console.log("ERR", e.stack || e)));
    return new Response("EVENT_RECEIVED");
  },
};

// ---------- keyword matching: the word must be ALONE ----------
export function matchKeyword(text) {
  if (!text) return null;
  const clean = text
    .replace(/[‎‏‪-‮]/g, "")          // direction marks
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "") // emoji
    .replace(/[.,!?;:"()\-–_*~…]/g, " ")
    .replace(/[׳’`]/g, "'")
    .replace(/\s+/g, " ").trim();
  for (const [kw, key] of Object.entries(CONFIG.keywords)) {
    if (clean === kw.replace(/[׳’`]/g, "'")) return key;
  }
  return null; // inside a sentence or unknown -> send nothing
}

async function handle(body, env) {
  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      if (await seen(ev.message?.mid || ev.postback?.mid)) continue;
      if (ev.message && !ev.message.is_echo) await onDM(ev, env);
      else if (ev.postback) await onPostback(ev, env);
    }
    for (const ch of entry.changes || []) {
      if (ch.field === "comments" && !(await seen("c" + ch.value.id))) await onComment(ch.value, env);
    }
  }
}

async function onDM(ev, env) {
  const key = matchKeyword(ev.message.text);
  if (!key) return;
  await sendLinkOrFollow(ev.sender.id, key, env);
}

async function onPostback(ev, env) {
  const [kind, key] = String(ev.postback.payload || "").split(":");
  if ((kind === "SEND" || kind === "FOLLOWCHECK") && key) {
    await sendLinkOrFollow(ev.sender.id, key, env);
  }
}

async function onComment(c, env) {
  if (c.from?.id === env.IG_USER_ID) return; // my own comments
  const key = matchKeyword(c.text);
  if (!key) return;
  if (CONFIG.texts.publicReply) {
    await ig(`/${c.id}/replies`, { message: CONFIG.texts.publicReply }, env);
  }
  // Meta allows ONE private reply per comment, and we can't check follow yet,
  // so we send the short opening with a button. The tap lets us check follow.
  await ig("/me/messages", {
    recipient: { comment_id: c.id },
    message: buttons(CONFIG.texts.opening, [
      { type: "postback", title: CONFIG.texts.openingButton, payload: `SEND:${key}` },
    ]),
  }, env);
}

async function sendLinkOrFollow(userId, key, env) {
  const follows = await isFollower(userId, env);
  const t = CONFIG.texts;
  const msg = follows
    ? buttons(t.link, [{ type: "web_url", url: CONFIG.formBase + key, title: t.linkButton }])
    : buttons(t.follow, [
        { type: "web_url", url: CONFIG.profileUrl, title: t.followButton },
        { type: "postback", title: t.followCheckButton, payload: `FOLLOWCHECK:${key}` },
      ]);
  await ig("/me/messages", { recipient: { id: userId }, message: msg }, env);
}

async function isFollower(userId, env) {
  const r = await fetch(`${API}/${userId}?fields=is_user_follow_business&access_token=${env.IG_TOKEN}`);
  const j = await r.json();
  if (j.error) { console.log("profile error", JSON.stringify(j.error)); return false; }
  return j.is_user_follow_business === true;
}

function buttons(text, btns) {
  return { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } } };
}

async function ig(path, payload, env) {
  if (env.DRY_RUN === "1") { console.log("DRY_RUN", path, JSON.stringify(payload)); return; }
  const r = await fetch(`${API}${path}?access_token=${env.IG_TOKEN}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (j.error) console.log("send error", path, JSON.stringify(j.error));
  return j;
}

// Meta retries events; remember ids for 1 day so nobody gets 2 messages.
async function seen(id) {
  if (!id) return false;
  const k = new Request("https://dedupe.local/" + encodeURIComponent(id));
  if (await caches.default.match(k)) return true;
  await caches.default.put(k, new Response("1", { headers: { "cache-control": "max-age=86400" } }));
  return false;
}

async function validSignature(raw, header, secret) {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return header === "sha256=" + hex;
}
