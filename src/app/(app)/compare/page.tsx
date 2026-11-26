import { CompareTool } from "./compare-tool";

export const metadata = { title: "Compare prices · Pong Money" };

// Price per ml, g, piece or m, so different sizes and deals can be ranked.
// A quick calculator: nothing is saved. Opened from Settings & tools and Grocery.
export default function ComparePage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-xl">
      <CompareTool />
    </div>
  );
}
