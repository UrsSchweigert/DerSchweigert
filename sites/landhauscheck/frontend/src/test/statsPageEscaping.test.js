// The stats dashboard (public/stats.html) renders visitor-controlled strings:
// the User-Agent and request path of every request, and the city/country a
// third-party geocoder returned. They used to go into innerHTML unescaped, so a
// request with a crafted User-Agent ran script on the PIN-protected page. These
// tests run the page's own script against hostile data and assert that it
// creates no elements from that data and shows it as plain text.
import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it } from "vitest";

const html = readFileSync(resolve(__dirname, "../../public/stats.html"), "utf-8");

function loadPage() {
  const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  // Drop the page's own polling bootstrap; the tests call the renderers directly.
  const code = script.replace(/^load\(\);$/m, "").replace(/^setInterval\(load, 30_000\);$/m, "");
  return new Function(
    `${code}; return { renderSessionsTable, renderErrors, renderEpTable, renderRecent };`,
  )();
}

const HOSTILE = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;

describe("stats.html escapes visitor-controlled values", () => {
  let page;
  beforeEach(() => {
    page = loadPage();
  });

  function assertInert(container) {
    expect(container.querySelector("img, script, svg, iframe")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  }

  it("renders a hostile User-Agent, city and country as text", () => {
    page.renderSessionsTable([
      {
        id: "abc", first_seen: "2026-11-18T10:00:00", last_seen: "10:05", hits: 3, active: true,
        city: HOSTILE, country: HOSTILE, providers: {}, ua: HOSTILE,
      },
    ]);
    const table = document.getElementById("sessions-table");
    assertInert(table);
    const titled = table.querySelector("td[title]");
    expect(titled.getAttribute("title")).toBe(HOSTILE);
  });

  it("renders hostile bot User-Agents in the summary row as text", () => {
    page.renderSessionsTable([
      { id: "b", first_seen: "x", last_seen: "x", hits: 1, providers: {}, ua: `curl/8.0 ${HOSTILE}` },
    ]);
    expect(document.getElementById("sessions-table").querySelector("img, script")).toBeNull();
  });

  it("renders hostile request paths as text in every table", () => {
    const path = `/api/${HOSTILE}`;
    page.renderErrors([{ ts: "t", path, status: 500, ms: 1 }]);
    page.renderEpTable([{ path, hits: 1, errors: 0, error_rate: 0, avg_ms: 1 }]);
    page.renderRecent([{ ts: "t", path, status: 200, ms: 1 }]);
    for (const id of ["errors-table", "ep-table", "recent-table"]) {
      assertInert(document.getElementById(id));
    }
  });
});
