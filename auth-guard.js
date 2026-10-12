// Authentication guard and shared 10-minute inactivity timeout for AssetGuard pages
import { getFirebaseApp } from "./ag-firebase.js";
import { getAuth, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const IDLE_LIMIT_MS = 10 * 60 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 5000;

// Keep the page hidden until Firebase confirms the saved session.
const hasVerifiedSession = sessionStorage.getItem("ag_auth_verified") === "1";
if (!hasVerifiedSession) document.documentElement.style.visibility = "hidden";

function notifyPageReady() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "assetguard:page-ready", page: window.location.pathname.split("/").pop() }, window.location.origin);
  }
}

const app = getFirebaseApp();
const auth = getAuth(app);
let authResolved = false;
let activeUserId = null;
let stopIdleProtection = null;
let authNotice = null;
let authNoticeText = null;

function showAuthNotice(message) {
  if (!authNotice) {
    authNotice = document.createElement("div");
    authNotice.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:#fff;color:#0f172a;font-family:system-ui,sans-serif;";
    const card = document.createElement("div");
    card.style.cssText = "max-width:420px;padding:24px;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 40px rgba(15,23,42,.12);text-align:center;";
    authNoticeText = document.createElement("p");
    authNoticeText.style.cssText = "margin:0 0 18px;line-height:1.5;";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry sign-in check";
    retry.style.cssText = "border:0;border-radius:10px;padding:11px 16px;background:#0072ce;color:#fff;font-weight:700;cursor:pointer;";
    retry.addEventListener("click", () => window.location.reload());
    card.append(authNoticeText, retry);
    authNotice.append(card);
  }
  authNoticeText.textContent = message;
  if (!authNotice.isConnected) document.body.append(authNotice);
  document.documentElement.style.visibility = "";
}

function clearAuthNotice() {
  if (authNotice && authNotice.isConnected) authNotice.remove();
}

function startIdleProtection(user) {
  if (activeUserId === user.uid && stopIdleProtection) return true;
  if (stopIdleProtection) stopIdleProtection();

  activeUserId = user.uid;
  const activityKey = "ag_last_activity_" + user.uid;
  const readActivity = () => {
    try {
      const value = Number(localStorage.getItem(activityKey));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) {
      return 0;
    }
  };
  const writeActivity = (value) => {
    try { localStorage.setItem(activityKey, String(value)); } catch (_) {}
  };
  let lastActivity = readActivity();
  let lastWrite = lastActivity;

  const signOutForIdle = () => {
    if (stopIdleProtection) stopIdleProtection();
    stopIdleProtection = null;
    try { localStorage.removeItem(activityKey); } catch (_) {}
    sessionStorage.removeItem("ag_auth_verified");
    showAuthNotice("You were signed out after more than 10 minutes of inactivity.");
    signOut(auth).catch(error => {
      if (typeof AGErrors !== "undefined") AGErrors.report("idle sign-out", error);
    });
  };

  if (lastActivity && Date.now() - lastActivity >= IDLE_LIMIT_MS) {
    signOutForIdle();
    return false;
  }
  if (!lastActivity) {
    lastActivity = Date.now();
    lastWrite = lastActivity;
    writeActivity(lastActivity);
  }

  const latestActivity = () => {
    const sharedActivity = readActivity();
    if (sharedActivity > lastActivity) lastActivity = sharedActivity;
    return lastActivity;
  };
  const expireIfIdle = () => {
    if (Date.now() - latestActivity() >= IDLE_LIMIT_MS) {
      signOutForIdle();
      return true;
    }
    return false;
  };
  const recordActivity = () => {
    if (document.visibilityState === "hidden" || expireIfIdle()) return;
    const now = Date.now();
    if (now - lastWrite >= ACTIVITY_WRITE_INTERVAL_MS) {
      lastActivity = now;
      lastWrite = now;
      writeActivity(now);
    }
  };
  const handleStorage = event => {
    if (event.key === activityKey && Number(event.newValue) > lastActivity) lastActivity = Number(event.newValue);
    expireIfIdle();
  };
  const handleVisibility = () => { if (document.visibilityState === "visible") recordActivity(); };
  const timer = window.setInterval(expireIfIdle, 1000);
  const activityEvents = ["pointerdown", "pointermove", "keydown", "scroll", "wheel", "touchstart", "click"];
  activityEvents.forEach(type => document.addEventListener(type, recordActivity, { passive: true }));
  window.addEventListener("focus", recordActivity);
  window.addEventListener("pageshow", recordActivity);
  window.addEventListener("storage", handleStorage);
  document.addEventListener("visibilitychange", handleVisibility);

  const cleanup = () => {
    window.clearInterval(timer);
    activityEvents.forEach(type => document.removeEventListener(type, recordActivity));
    window.removeEventListener("focus", recordActivity);
    window.removeEventListener("pageshow", recordActivity);
    window.removeEventListener("storage", handleStorage);
    document.removeEventListener("visibilitychange", handleVisibility);
    if (stopIdleProtection === cleanup) stopIdleProtection = null;
  };
  stopIdleProtection = cleanup;
  return true;
}

// Complete internal passcode reset link if present.
async function completeInternalResetLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("internalReset")) return;
  if (!isSignInWithEmailLink(auth, window.location.href)) return;
  const email = localStorage.getItem("ag_internal_reset_email")
    || window.prompt("Confirm the e-mail address this reset link was sent to");
  if (!email) return;
  try {
    await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem("ag_internal_reset_email");
    const clean = new URL(window.location.href);
    ["apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"].forEach(key => clean.searchParams.delete(key));
    history.replaceState(null, "", clean.pathname + clean.search);
  } catch (error) {
    if (typeof AGErrors !== "undefined") AGErrors.report("internal reset link sign-in", error);
  }
}

await completeInternalResetLink();

onAuthStateChanged(auth, (user) => {
  authResolved = true;
  if (user) {
    if (!startIdleProtection(user)) return;
    sessionStorage.setItem("ag_auth_verified", "1");
    clearAuthNotice();
    document.documentElement.style.visibility = "";
    notifyPageReady();
  } else {
    if (stopIdleProtection) stopIdleProtection();
    if (activeUserId) {
      try { localStorage.removeItem("ag_last_activity_" + activeUserId); } catch (_) {}
    }
    activeUserId = null;
    sessionStorage.removeItem("ag_auth_verified");
    clearAuthNotice();
    window.location.replace("index.html");
  }
}, (error) => {
  authResolved = true;
  if (typeof AGErrors !== "undefined") AGErrors.report("authentication initialization", error);
  showAuthNotice("We couldn't confirm your sign-in. Your session has not been cleared; retry the check when you're ready.");
});

// Slow Firebase initialization no longer clears the saved session or redirects to sign-in.
setTimeout(() => {
  if (!authResolved) showAuthNotice("Your sign-in check is taking longer than expected. Your saved session has not been cleared.");
}, 4000);
