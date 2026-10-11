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
