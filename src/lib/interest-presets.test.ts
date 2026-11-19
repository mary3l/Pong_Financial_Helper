import { describe, expect, it } from "vitest";
import { interestPresetFor, matchesPreset } from "@/lib/interest-presets";
import { suggestedPayout } from "@/lib/money";

describe("interest presets", () => {
  it("finds the preset from the wallet's name", () => {
    expect(interestPresetFor("MariBank")?.rate).toBe(3.25);
    expect(interestPresetFor("SeaBank savings")?.key).toBe("maribank");
    expect(interestPresetFor("GCash GSave")?.rate).toBe(2.3);
    expect(interestPresetFor("CIMB")?.key).toBe("gsave");
    expect(interestPresetFor("Maya Savings")?.rate).toBe(3);
    expect(interestPresetFor("GoTyme Emergency")).toMatchObject({
      key: "gotyme",
      rate: 3,
      payout: "monthly",
    });
    expect(interestPresetFor("BPI")).toBeNull();
  });

  it("starts GoTyme and GSave as monthly, the rest daily", () => {
    expect(suggestedPayout("GoTyme Go Save")).toBe("monthly");
    expect(suggestedPayout("GSave")).toBe("monthly");
    expect(suggestedPayout("Maya Savings")).toBe("daily");
    expect(suggestedPayout("MariBank")).toBe("daily");
    expect(suggestedPayout("Wallet")).toBe("daily");
  });

  it("stops offering once the wallet is set up like the preset", () => {
    const maya = interestPresetFor("Maya")!;
    expect(
      matchesPreset(maya, { type: "ewallet", purpose: "spending", rate: "3", payout: "daily" }),
    ).toBe(true);
    expect(
      matchesPreset(maya, { type: "ewallet", purpose: "spending", rate: "3.00%", payout: "daily" }),
    ).toBe(true);
    expect(
      matchesPreset(maya, { type: "ewallet", purpose: "spending", rate: "", payout: "daily" }),
    ).toBe(false);

    // GoalSave is savings: a Spending wallet isn't set up yet.
    const goTyme = interestPresetFor("GoTyme")!;
    expect(
      matchesPreset(goTyme, { type: "bank", purpose: "spending", rate: "3", payout: "monthly" }),
    ).toBe(false);
    expect(
      matchesPreset(goTyme, { type: "bank", purpose: "savings", rate: "3", payout: "monthly" }),
    ).toBe(true);
  });
});

describe("GoTyme USD Time Deposit", () => {
  it("is offered for a GoTyme wallet named for dollars or a time deposit", () => {
    for (const name of [
      "GoTyme USD",
      "GoTyme USD Time Deposit",
      "USD GoTyme",
      "GoTyme Dollar TD",
      "GoTyme time deposit",
    ]) {
      expect(interestPresetFor(name)).toMatchObject({
        key: "gotyme_usd_td",
        currency: "USD",
        payout: "maturity",
        rate: null,
      });
    }
    // Other GoTyme wallets are still GoalSaves.
    expect(interestPresetFor("GoTyme Emergency")?.key).toBe("gotyme");
    expect(interestPresetFor("GoTyme Tuition")?.key).toBe("gotyme");
    expect(suggestedPayout("GoTyme USD")).toBe("maturity");
  });

  it("is set up once it's a dollar savings bank paid at maturity, whatever rate you typed", () => {
    const td = interestPresetFor("GoTyme USD")!;
    const wallet = {
      type: "bank" as const,
      purpose: "savings",
      rate: "3.5",
      payout: "maturity" as const,
      currency: "USD" as const,
    };
    expect(matchesPreset(td, wallet)).toBe(true);
    expect(matchesPreset(td, { ...wallet, rate: "" })).toBe(true);
    expect(matchesPreset(td, { ...wallet, currency: "PHP" })).toBe(false);
    expect(matchesPreset(td, { ...wallet, payout: "monthly" })).toBe(false);
  });
});
