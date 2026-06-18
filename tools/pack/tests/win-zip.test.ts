import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { winResources } from "../src/resources.js";
import { resolveWinPortableZipInvocation } from "../src/win/zip.js";

describe("resolveWinPortableZipInvocation", () => {
  it("uses bundled 7z on Windows", () => {
    const invocation = resolveWinPortableZipInvocation(
      { setupZipPath: join("C:", "out", "Open Design-default-portable.zip") },
      { unpackedRoot: join("C:", "out", "win-unpacked") },
      "win32",
    );

    expect(invocation).toEqual({
      args: ["a", "-tzip", "-mx=5", join("C:", "out", "Open Design-default-portable.zip"), ".\\*"],
      command: winResources.sevenZipExe,
      cwd: join("C:", "out", "win-unpacked"),
      outputPath: join("C:", "out", "Open Design-default-portable.zip"),
    });
  });

  it("uses the host zip tool for cross-built portable Windows zips", () => {
    const invocation = resolveWinPortableZipInvocation(
      { setupZipPath: "/tmp/out/Open Design-default-portable.zip" },
      { unpackedRoot: "/tmp/out/win-unpacked" },
      "darwin",
    );

    expect(invocation).toEqual({
      args: ["-r", "-q", "/tmp/out/Open Design-default-portable.zip", "."],
      command: "zip",
      cwd: "/tmp/out/win-unpacked",
      outputPath: "/tmp/out/Open Design-default-portable.zip",
    });
  });
});
