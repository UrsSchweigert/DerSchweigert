import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import AppConsole from "../components/AppConsole";

const props = {
  apiBaseUrl: "https://landhauscheck.com",
  healthState: { status: "error", detail: "Failed to fetch", isLoading: false },
  statuses: {},
  errors: {},
  countdowns: {},
  consoleLogs: [{ ts: "12:00:00", message: "GET https://landhauscheck.com/health: TypeError: Failed to fetch" }],
};

it("shows page origin, network context and request diagnostics", () => {
  render(<AppConsole {...props} />);

  expect(screen.getByText(window.location.origin)).toBeInTheDocument();
  expect(screen.getByText(/API reachability not guaranteed/)).toBeInTheDocument();
  expect(screen.getByText(props.consoleLogs[0].message)).toBeInTheDocument();
});

it("no longer fetches server logs (the PIN-protected /api/v1/logs endpoint is gone)", () => {
  render(<AppConsole {...props} />);
  expect(screen.queryByText(/CloudWatch/)).not.toBeInTheDocument();
});
