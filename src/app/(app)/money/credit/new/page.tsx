import Link from "next/link";
import { CreditLineForm } from "../../credit-line-form";

export const metadata = { title: "Add credit card or BNPL · Pong Money" };

// Adds a bank credit card (BPI, BDO…) or BNPL (SPayLater, Atome, MariBank, GoTyme).
export default function NewCreditLinePage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-xl">
      <Link href="/money" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">
        ‹ Money
      </Link>
      <h1 className="font-display text-3xl font-semibold">Add credit card or BNPL</h1>
      <div className="rounded-[20px] bg-card p-4">
        <CreditLineForm />
      </div>
    </div>
  );
}
