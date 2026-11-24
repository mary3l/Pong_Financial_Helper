import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveGoal } from "@/app/goal-actions";
import { GoalComposer, type GoalPrefill } from "./goal-controls";

vi.mock("@/app/goal-actions", () => ({
  saveGoal: vi.fn(async () => ({})),
  removeGoal: vi.fn(async () => ({})),
}));
vi.mock("@/app/plan-actions", () => ({ saveBudget: vi.fn(async () => ({})) }));
const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const TODAY = "2026-11-24";
const prefill: GoalPrefill = { category: "food", sub: "Needs", limit: 6000, endsOn: "2026-12-23" };

function renderComposer(p: GoalPrefill | null) {
  const user = userEvent.setup();
  render(
    <GoalComposer
      hasGoals={false}
      categories={[
        { key: "food", label: "Food" },
        { key: "transport", label: "Transpo" },
      ]}
      subcategories={{}}
      usual={{}}
      ends={{ kinsenas: "2026-11-30", month: "2026-11-30" }}
      today={TODAY}
      prefill={p}
    />,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/insights?goal=1&gc=food&gs=Needs&gl=6000&ge=2026-12-23");
});

describe("the goal panel", () => {
  it("starts closed, and opens", async () => {
    const user = renderComposer(null);
    expect(screen.queryByRole("region", { name: "New goal" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Set your first goal/ }));
    expect(screen.getByRole("region", { name: "New goal" })).toBeInTheDocument();
  });

  it("opens filled in from Make it a goal, and Cancel leaves without saving", async () => {
    const user = renderComposer(prefill);
    expect(screen.getByRole("region", { name: "Make it a goal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Spend under")).toHaveValue("6000");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Make it a goal" })).not.toBeInTheDocument();
    expect(saveGoal).not.toHaveBeenCalled();
    // The suggestion's details leave the URL, so a refresh doesn't open it again.
    expect(router.replace).toHaveBeenCalledWith("/insights#goals", { scroll: false });
  });

  it("closes with its ✕, and with Esc", async () => {
    const user = renderComposer(prefill);
    await user.click(screen.getByRole("button", { name: "Close without saving" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Set your first goal/ }));
    await user.click(screen.getByLabelText("Spend under"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("closes once the goal is saved", async () => {
    const user = renderComposer(prefill);
    await user.click(screen.getByRole("button", { name: "Set goal" }));
    expect(saveGoal).toHaveBeenCalledWith({
      category: "food",
      subcategory: "Needs",
      limit: 6000,
      endsOn: "2026-12-23",
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
