import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTrip, saveTrip, type ActiveTrip } from "@/lib/active-trip";
import { CompareTool } from "./compare-tool";

vi.mock("@/lib/active-trip", () => ({
  loadTrip: vi.fn(async () => null),
  saveTrip: vi.fn(async () => {}),
}));
const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const trip: ActiveTrip = {
  budget: 2000,
  store: "Gaisano",
  accountId: "w1",
  warnAt: 0.8,
  items: [{ key: "k1", barcode: "123", name: "Rice", price: 250, qty: 1 }],
  step: "scan",
  startedOn: "2026-11-26",
};

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  v: Record<string, string>,
) {
  const label = `Product ${n}`;
  if (v.name) await user.type(screen.getByLabelText(`Name of ${label}`), v.name);
  const name = v.name ?? label;
  if (v.size) await user.type(screen.getByLabelText(`Size of ${name}`), v.size);
  if (v.count) {
    await user.clear(screen.getByLabelText(`Packs in the deal for ${name}`));
    await user.type(screen.getByLabelText(`Packs in the deal for ${name}`), v.count);
  }
  if (v.price) await user.type(screen.getByLabelText(`Price of ${name}`), v.price);
}

async function lotions() {
  const user = userEvent.setup();
  render(<CompareTool />);
  await fill(user, 1, { name: "Lotion A", size: "500", count: "2", price: "599" });
  await fill(user, 2, { name: "Lotion B", size: "900", price: "580" });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTrip).mockResolvedValue(null);
});

describe("compare prices", () => {
  it("marks the best deal and how much more the other costs", async () => {
    await lotions();
    const a = screen.getByRole("listitem", { name: "Lotion A" });
    const b = screen.getByRole("listitem", { name: "Lotion B" });
    expect(within(a).getByText("★ Best deal")).toBeInTheDocument();
    expect(within(a).getByText("₱59.90 / 100 ml")).toBeInTheDocument();
    expect(within(b).getByText("₱64.44 / 100 ml")).toBeInTheDocument();
    expect(within(b).getByText("+7.6%")).toBeInTheDocument();
  });

  it("moves the badge when a price changes", async () => {
    const user = await lotions();
    const price = screen.getByLabelText("Price of Lotion B");
    await user.clear(price);
    await user.type(price, "500");
    expect(
      within(screen.getByRole("listitem", { name: "Lotion B" })).getByText("★ Best deal"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: "Lotion A" })).queryByText("★ Best deal"),
    ).toBeNull();
  });

  it("can't compare different kinds of unit", async () => {
    const user = await lotions();
    await user.selectOptions(screen.getByLabelText("Unit of Lotion B"), "g");
    expect(screen.getByText("Can't compare g with ml")).toBeInTheDocument();
    expect(screen.queryByText("★ Best deal")).toBeNull();
  });

  it("adds, removes and clears products", async () => {
    const user = await lotions();
    await user.click(screen.getByRole("button", { name: "+ Add product" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Remove Lotion A" }));
    expect(screen.queryByRole("listitem", { name: "Lotion A" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("listitem", { name: "Lotion B" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("has no Add to cart without a grocery trip", async () => {
    await lotions();
    expect(screen.queryByRole("button", { name: "Add to cart" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("adds the chosen product to the grocery cart", async () => {
    vi.mocked(loadTrip).mockResolvedValue(trip);
    const user = await lotions();
    await waitFor(() => expect(screen.getByRole("link", { name: "Grocery" })).toBeInTheDocument());
    const a = screen.getByRole("listitem", { name: "Lotion A" });
    await user.click(within(a).getByRole("button", { name: "Add to cart" }));
    expect(saveTrip).toHaveBeenCalledWith({
      ...trip,
      items: [
        { key: expect.any(String), barcode: null, name: "Lotion A 500 ml ×2", price: 599, qty: 1 },
        trip.items[0],
      ],
    });
    expect(router.push).toHaveBeenCalledWith("/grocery");
  });
});
