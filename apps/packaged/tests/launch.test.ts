import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {},
}));

import { PackagedPathAccessError } from "../src/errors.js";
import {
  claimPackagedSingleInstanceLock,
  type PackagedSingleInstanceApp,
  verifyPackagedDataRootWritable,
} from "../src/launch.js";

type SecondInstanceListener = (
  event: unknown,
  commandLine: string[],
  workingDirectory: string,
) => void;

describe("verifyPackagedDataRootWritable", () => {
  it("accepts a writable dataRoot", async () => {
    const root = mkdtempSync(join(tmpdir(), "od-packaged-launch-"));
    try {
      const dataRoot = join(root, "namespaces", "release-beta", "data");
      await expect(verifyPackagedDataRootWritable({ dataRoot })).resolves.toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("wraps low-level mkdir/access failures with a user-actionable error", async () => {
    const root = mkdtempSync(join(tmpdir(), "od-packaged-launch-"));
    try {
      const blocker = join(root, "namespaces", "release-beta");
      mkdirSync(blocker, { recursive: true });
      writeFileSync(join(blocker, "data"), "not a directory");

      let captured: unknown;
      try {
        await verifyPackagedDataRootWritable({ dataRoot: join(blocker, "data") });
      } catch (error) {
        captured = error;
      }

      expect(captured).toBeInstanceOf(PackagedPathAccessError);
      expect((captured as Error).message).toContain("Open Design could not create or write to:");
      expect((captured as Error).message).toContain(join(blocker, "data"));
      expect((captured as Error).message).toContain("Current user:");
      expect((captured as Error).message).toContain("Try in Terminal:");
      expect((captured as Error).message).toContain("sudo chown -R");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("claimPackagedSingleInstanceLock", () => {
  it("registers a second-instance focus callback when the lock is acquired", () => {
    const listeners = new Map<string, SecondInstanceListener>();
    const app: PackagedSingleInstanceApp = {
      on: vi.fn((event: "second-instance", listener: SecondInstanceListener) => {
        listeners.set(event, listener);
        return app;
      }),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
    };
    const focusExisting = vi.fn();

    expect(claimPackagedSingleInstanceLock(app, focusExisting)).toBe(true);
    listeners.get("second-instance")?.({}, ["Open Design"], "/tmp");

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith("second-instance", expect.any(Function));
    expect(app.quit).not.toHaveBeenCalled();
    expect(focusExisting).toHaveBeenCalledWith(["Open Design"]);
  });

  it("forwards second-instance command lines so protocol callbacks reach the running app", () => {
    const listeners = new Map<string, SecondInstanceListener>();
    const app: PackagedSingleInstanceApp = {
      on: vi.fn((event: "second-instance", listener: SecondInstanceListener) => {
        listeners.set(event, listener);
        return app;
      }),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
    };
    const onSecondInstance = vi.fn();

    expect(claimPackagedSingleInstanceLock(app, onSecondInstance)).toBe(true);
    listeners.get("second-instance")?.(
      {},
      ["Open Design", "od://cloud-schedule-auth?token=t&state=s"],
      "/tmp",
    );

    expect(onSecondInstance).toHaveBeenCalledWith([
      "Open Design",
      "od://cloud-schedule-auth?token=t&state=s",
    ]);
  });

  it("quits the duplicate process before packaged sidecars start when the lock is held", () => {
    const app = {
      on: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => false),
    };

    expect(claimPackagedSingleInstanceLock(app, vi.fn())).toBe(false);

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.on).not.toHaveBeenCalled();
  });
});
