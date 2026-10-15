import { describe, expect, it } from "vitest";
import { cn, nanoid } from "@/lib/utils";

describe("lib/utils.ts", () => {
  it("cn merges class names and lets the last tailwind utility win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });

  it("nanoid draws ids from the lowercase alphanumeric alphabet", () => {
    const id = nanoid();
    expect(id).toMatch(/^[a-z0-9]{21}$/);
    expect(nanoid()).not.toBe(id);
  });
});
