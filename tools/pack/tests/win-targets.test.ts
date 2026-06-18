import { describe, expect, it } from "vitest";

import {
  resolveElectronBuilderWinTargets,
  resolveWinTargets,
  shouldBuildWinNsisInstaller,
  shouldBuildWinPortableZip,
} from "../src/win/report.js";
import { shouldBuildWinLauncherPayloadArtifact } from "../src/win/build.js";

describe("resolveWinTargets", () => {
  it("returns the full target set including the portable zip for `all`", () => {
    expect(resolveWinTargets("all")).toEqual(["dir", "nsis", "zip"]);
  });

  it("returns only the requested single target", () => {
    expect(resolveWinTargets("dir")).toEqual(["dir"]);
    expect(resolveWinTargets("nsis")).toEqual(["nsis"]);
    expect(resolveWinTargets("zip")).toEqual(["zip"]);
  });
});

describe("resolveElectronBuilderWinTargets", () => {
  it("hides the portable zip from electron-builder because it is built from the cached unpacked dir", () => {
    expect(resolveElectronBuilderWinTargets("zip")).toEqual(["dir"]);
    expect(resolveElectronBuilderWinTargets("all")).toEqual(["dir", "nsis"]);
    expect(resolveElectronBuilderWinTargets("nsis")).toEqual(["nsis"]);
    expect(resolveElectronBuilderWinTargets("dir")).toEqual(["dir"]);
  });
});

describe("shouldBuildWinNsisInstaller / shouldBuildWinPortableZip", () => {
  it("flags the NSIS installer and portable zip independently", () => {
    expect(shouldBuildWinNsisInstaller("nsis")).toBe(true);
    expect(shouldBuildWinNsisInstaller("all")).toBe(true);
    expect(shouldBuildWinNsisInstaller("zip")).toBe(false);
    expect(shouldBuildWinNsisInstaller("dir")).toBe(false);

    expect(shouldBuildWinPortableZip("zip")).toBe(true);
    expect(shouldBuildWinPortableZip("all")).toBe(true);
    expect(shouldBuildWinPortableZip("nsis")).toBe(false);
    expect(shouldBuildWinPortableZip("dir")).toBe(false);
  });
});

describe("shouldBuildWinLauncherPayloadArtifact", () => {
  it("skips the Windows-only launcher payload for cross-built dir and portable zip targets", () => {
    expect(shouldBuildWinLauncherPayloadArtifact("darwin", "dir")).toBe(false);
    expect(shouldBuildWinLauncherPayloadArtifact("darwin", "zip")).toBe(false);
    expect(shouldBuildWinLauncherPayloadArtifact("linux", "zip")).toBe(false);
  });

  it("keeps launcher payload generation for Windows hosts and NSIS release paths", () => {
    expect(shouldBuildWinLauncherPayloadArtifact("win32", "dir")).toBe(true);
    expect(shouldBuildWinLauncherPayloadArtifact("win32", "zip")).toBe(true);
    expect(shouldBuildWinLauncherPayloadArtifact("darwin", "nsis")).toBe(true);
    expect(shouldBuildWinLauncherPayloadArtifact("darwin", "all")).toBe(true);
  });
});
