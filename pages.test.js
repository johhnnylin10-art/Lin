import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// index.html is the login page itself, so it must stay reachable without a session.
const UNGUARDED = new Set(["index.html"]);

const pages = readdirSync(repoRoot).filter((file) => file.endsWith(".html"));

describe("auth guard coverage", () => {
  it("finds the application pages", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it.each(pages.filter((page) => !UNGUARDED.has(page)))(
    "%s loads auth-guard.js",
    (page) => {
      const html = readFileSync(path.join(repoRoot, page), "utf8");
      expect(html).toContain('<script type="module" src="auth-guard.js"></script>');
    }
  );
});

describe("realtime database rules", () => {
  const rules = JSON.parse(readFileSync(path.join(repoRoot, "database.rules.json"), "utf8")).rules;

  it("denies reads and writes at the root", () => {
    expect(rules[".read"]).toBe(false);
    expect(rules[".write"]).toBe(false);
  });

  it("requires authentication on every top level node", () => {
    for (const [node, definition] of Object.entries(rules)) {
      if (node.startsWith(".")) continue;
      const expressions = JSON.stringify(definition).match(/"\.(read|write)":\s*"[^"]*"/g) || [];
      expect(expressions.length, `${node} has no auth conditions`).toBeGreaterThan(0);
      for (const expression of expressions) {
        expect(expression, `${node} allows unauthenticated access`).toContain("auth != null");
      }
    }
  });

  it("scopes per-user nodes to the owning uid or the master admin", () => {
    for (const node of ["users", "profiles", "user_settings", "subscriptions", "user_statuses"]) {
      expect(rules[node].$uid[".read"]).toContain("auth.uid == $uid");
      expect(rules[node].$uid[".write"]).toContain("auth.uid == $uid");
    }
  });

  it("indexes support_tickets on uid so the dashboard query keeps working", () => {
    expect(rules.support_tickets[".indexOn"]).toBe("uid");
  });
});


describe("expense cloud persistence", () => {
  const entryPage = readFileSync(path.join(repoRoot, "expenses.html"), "utf8");
  const historyPage = readFileSync(path.join(repoRoot, "expenses_history.html"), "utf8");

  it("requires the shared Firebase auth guard on the expense entry page", () => {
    expect(entryPage).toContain('<script type="module" src="auth-guard.js"></script>');
  });

  it("uses the signed-in user's cloud expense path on both screens", () => {
    expect(entryPage).toContain('cloudPath = "users/" + user.uid + "/expenses"');
    expect(historyPage).toContain('cloudPath = "users/" + user.uid + "/expenses"');
    expect(historyPage).not.toContain('const cloudPath = "expenses"');
  });

  it("warns when a save is local-only and has not reached Firebase", () => {
    expect(entryPage).toContain("Saved on this device only. Reconnect and sync before clearing browser data.");
    expect(entryPage).toContain("Expense saved to your cloud account.");
    expect(entryPage).toContain("Some expenses are only stored in this browser.");
  });
});


describe("field location sharing", () => {
  const dashboard = readFileSync(path.join(repoRoot, "dashboard.html"), "utf8");
  const login = readFileSync(path.join(repoRoot, "login.html"), "utf8");
  const authGuard = readFileSync(path.join(repoRoot, "auth-guard.js"), "utf8");
  const locations = rules.field_locations;

  it("limits live location reads and writes to marketing accounts and each user's own record", () => {
    expect(locations[".read"]).toContain("role').val() == 'marketing_team'");
    expect(locations.$uid[".read"]).toContain("role').val() == 'marketing_team'");
    expect(locations.$uid[".write"]).toContain("auth.uid == $uid");
    expect(locations.$uid[".write"]).toContain("role').val() == 'marketing_team'");
    expect(locations.$uid[".validate"]).toContain("newData.child('uid').val() == auth.uid");
  });

  it("shares location from the common auth guard across standalone pages and the dashboard", () => {
    expect(authGuard).toContain("navigator.geolocation.watchPosition");
    expect(authGuard).toContain("window.parent !== window");
    expect(authGuard).toContain('localStorage.getItem("ag_gps_consent_uid") !== user.uid');
    expect(authGuard).toContain('profile.role !== "marketing_team"');
    expect(dashboard).toContain('id="fieldLocationPanel"');
    expect(dashboard).toContain('rtdb.ref("field_locations")');
    expect(dashboard).not.toContain('id="marketingTeamNav"');
  });

  it("requires clear GPS-sharing consent for marketing sign-in only", () => {
    expect(login).toContain("Share live location while signed in");
    expect(login).toContain('localStorage.setItem("ag_gps_consent_uid", user.uid)');
    expect(login).toContain('localStorage.removeItem("ag_gps_consent_uid")');
  });
});
