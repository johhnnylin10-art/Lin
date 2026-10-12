// Authentication guard and shared 10-minute inactivity timeout for AssetGuard pages
import { getFirebaseApp, getDb } from "./ag-firebase.js";
import { get, ref, set, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
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

let gpsWatchId = null;
let gpsWatchUid = null;
let gpsHasRecord = false;
let locationUserForPage = null;

function setMarketingGpsNotice(text, active) {
  if (window.parent !== window) return;
  let badge = document.getElementById("ag-gps-share-indicator");
  if (!text) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "ag-gps-share-indicator";
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-live", "polite");
    badge.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border-radius:999px;font:700 11px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(2,6,23,.25);";
    document.body.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.color = active ? "#dcfce7" : "#f8fafc";
  badge.style.background = active ? "#166534" : "#334155";
}

async function stopMarketingLocationSharing(markStopped) {
  const uid = gpsWatchUid;
  if (gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  gpsWatchUid = null;
  if (markStopped && uid && gpsHasRecord) {
    try {
      await update(ref(getDb(), "field_locations/" + uid), { sharing: false, stoppedAt: Date.now() });
    } catch (error) {
      if (typeof AGErrors !== "undefined") AGErrors.report("stop GPS sharing", error);
    }
  }
  gpsHasRecord = false;
  if (markStopped) setMarketingGpsNotice("Location sharing stopped", false);
}

window.AGStopLocationSharing = (markStopped = true) => stopMarketingLocationSharing(markStopped);

async function startMarketingLocationSharing(user) {
  if (window.parent !== window) return;
  if (gpsWatchUid === user.uid && gpsWatchId !== null) return;
  if (gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  gpsWatchUid = null;
  gpsHasRecord = false;
  const db = getDb();
  const profileSnapshot = await get(ref(db, "users/" + user.uid));
  const profile = profileSnapshot.val() || {};
  if (auth.currentUser?.uid !== user.uid || profile.role !== "marketing_team") {
    setMarketingGpsNotice("", false);
    return;
  }
  if (!navigator.geolocation) {
    setMarketingGpsNotice("GPS is unavailable in this browser", false);
    return;
  }
  if (localStorage.getItem("ag_gps_consent_uid") !== user.uid) {
    setMarketingGpsNotice("GPS sharing is off. Sign in again and accept the location-sharing notice.", false);
    return;
  }

  setMarketingGpsNotice("Waiting for device GPS permission/location…", false);
  gpsWatchUid = user.uid;
  let lastWriteAt = 0;
  const locationRef = ref(db, "field_locations/" + user.uid);
  gpsWatchId = navigator.geolocation.watchPosition((position) => {
    const now = Date.now();
    if (now - lastWriteAt < 5000) return;
    lastWriteAt = now;
    const coords = position.coords;
    const record = {
      uid: user.uid,
      fullName: String(profile.fullName || (user.email || "Marketing member").split("@")[0]).slice(0, 100),
      teamRole: String(profile.teamRole || "Marketing").slice(0, 80),
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      updatedAt: now,
      sharing: true
    };
    set(locationRef, record).then(() => {
      gpsHasRecord = true;
      setMarketingGpsNotice("Live location sharing · Marketing Team", true);
    }).catch((error) => {
      setMarketingGpsNotice("Location could not be saved. Check your connection.", false);
      if (typeof AGErrors !== "undefined") AGErrors.report("marketing GPS update", error);
    });
  }, (error) => {
    setMarketingGpsNotice(error && error.code === error.PERMISSION_DENIED ? "GPS permission is off. Allow browser location access to resume sharing." : "Waiting for a fresh GPS location…", false);
    if (error && error.code === error.PERMISSION_DENIED && gpsHasRecord) {
      update(locationRef, { sharing: false, stoppedAt: Date.now() }).catch((writeError) => {
        if (typeof AGErrors !== "undefined") AGErrors.report("GPS permission status", writeError);
      });
    }
    if (typeof AGErrors !== "undefined") AGErrors.report("browser GPS watch", error);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

window.addEventListener("pagehide", () => {
  if (gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
});
window.addEventListener("pageshow", () => {
  if (locationUserForPage && auth.currentUser?.uid === locationUserForPage.uid) {
    startMarketingLocationSharing(locationUserForPage).catch((error) => {
      if (typeof AGErrors !== "undefined") AGErrors.report("resume GPS sharing", error);
    });
  }
});


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
    Promise.race([stopMarketingLocationSharing(true), new Promise(resolve => window.setTimeout(resolve, 1500))])
      .then(() => signOut(auth))
      .catch(error => { if (typeof AGErrors !== "undefined") AGErrors.report("idle sign-out", error); });
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

onAuthStateChanged(auth, async (user) => {
  authResolved = true;
  if (user) {
    if (!startIdleProtection(user)) return;
    locationUserForPage = user;
    startMarketingLocationSharing(user).catch((error) => {
      if (typeof AGErrors !== "undefined") AGErrors.report("start GPS sharing", error);
    });
    sessionStorage.setItem("ag_auth_verified", "1");
    clearAuthNotice();
    document.documentElement.style.visibility = "";
    notifyPageReady();
  } else {
    locationUserForPage = null;
    setMarketingGpsNotice("", false);
    await stopMarketingLocationSharing(false);
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
