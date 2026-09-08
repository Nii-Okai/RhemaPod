import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES } from "@/lib/upload/constants";
import { validateImageFile, validateMediaFile } from "@/lib/upload/validate";

/* W9 — pre-flight file validation (plan §A.5 step a: type + size checked
   BEFORE any network call). Pure; no DOM, no MSW. */

const f = (name: string, type: string, size: number) => ({ name, type, size });

describe("validateMediaFile — type", () => {
  it("maps each accepted extension to its canonical Content-Type", () => {
    expect(validateMediaFile(f("sermon.mp4", "video/mp4", 10))).toEqual({
      ok: true,
      kind: "video",
      contentType: "video/mp4",
    });
    expect(validateMediaFile(f("sermon.MOV", "", 10))).toEqual({
      ok: true,
      kind: "video",
      contentType: "video/quicktime",
    });
    expect(validateMediaFile(f("sermon.mp3", "audio/mpeg", 10))).toEqual({
      ok: true,
      kind: "audio",
      contentType: "audio/mpeg",
    });
    expect(validateMediaFile(f("sermon.m4a", "", 10))).toEqual({
      ok: true,
      kind: "audio",
      contentType: "audio/mp4",
    });
  });

  it("rejects an unsupported extension with a specific message", () => {
    const r = validateMediaFile(f("notes.txt", "text/plain", 10));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("type");
      expect(r.message).toContain("notes.txt");
      expect(r.message).toContain("MP4");
    }
  });

  it("rejects a good extension whose MIME contradicts the family", () => {
    const r = validateMediaFile(f("sermon.mp4", "text/plain", 10));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("type");
  });

  it("accepts a good extension when File.type is blank (browsers lie)", () => {
    expect(validateMediaFile(f("sermon.mp4", "", 10)).ok).toBe(true);
  });

  it("tolerates the .m4a-tagged-video/mp4 OS quirk", () => {
    expect(validateMediaFile(f("clip.m4a", "video/mp4", 10)).ok).toBe(true);
  });
});

describe("validateMediaFile — size", () => {
  it("accepts a file exactly at the cap", () => {
    expect(validateMediaFile(f("x.mp4", "video/mp4", MAX_UPLOAD_BYTES)).ok).toBe(
      true,
    );
  });

  it("rejects one byte over the cap, naming the GB limit", () => {
    const r = validateMediaFile(f("x.mp4", "video/mp4", MAX_UPLOAD_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("size");
      expect(r.message).toContain("5 GB limit");
    }
  });

  it("rejects an empty file", () => {
    const r = validateMediaFile(f("x.mp4", "video/mp4", 0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });
});

describe("validateImageFile", () => {
  it("accepts JPEG/PNG/WebP by extension", () => {
    expect(validateImageFile(f("a.jpg", "image/jpeg", 10)).ok).toBe(true);
    expect(validateImageFile(f("a.png", "", 10)).ok).toBe(true);
    expect(validateImageFile(f("a.webp", "image/webp", 10)).ok).toBe(true);
  });

  it("rejects a non-image and an oversized image", () => {
    expect(validateImageFile(f("a.gif", "image/gif", 10)).ok).toBe(false);
    const big = validateImageFile(f("a.png", "image/png", 11 * 1024 ** 2));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toBe("size");
  });
});
