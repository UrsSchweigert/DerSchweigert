import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppConsole from "../components/AppConsole";

afterEach(() => {
  vi.unstubAllGlobals();
});

const props = {
  apiBaseUrl: "https://landhauscheck.com",
  healthState: { status: "error", detail: "Failed to fetch", isLoading: false },
  statuses: {},
  errors: {},
  countdowns: {},
  consoleLogs: [{ ts: "12:00:00", message: "GET https://landhauscheck.com/health: TypeError: Failed to fetch" }],
};

it("shows page origin, network context and request diagnostics without hiding log-fetch failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  render(<AppConsole {...props} />);

  expect(screen.getByText(window.location.origin)).toBeInTheDocument();
  expect(screen.getByText(/API reachability not guaranteed/)).toBeInTheDocument();
  expect(screen.getByText(props.consoleLogs[0].message)).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("CloudWatch logs unavailable: Failed to fetch");
  expect(screen.queryByText(/No entries/)).not.toBeInTheDocument();
});

it("reports CloudWatch HTTP errors instead of an empty success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403, statusText: "Forbidden" })));
  render(<AppConsole {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 403 Forbidden");
});

it("preserves the empty-log display for a successful empty result", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  render(<AppConsole {...props} />);
  expect(await screen.findByText(/No entries/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
