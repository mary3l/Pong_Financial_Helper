import Link from "next/link";
import { CreditLineForm } from "../../credit-line-form";

export const metadata = { title: "Add BNPL or installments · Pong Money" };

// Adds SPayLater, Atome, a bank credit line (MariBank, GoTyme) or another BNPL.
export default function NewCreditLinePage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-xl">
      <Link href="/money" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">
        ‹ Money
      </Link>
      <h1 className="font-display text-3xl font-semibold">Add BNPL or installments</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        Buy now, pay later, or a bank credit line that splits purchases into installments. Purchases
        on it show up in your spending right away; paying the bill just moves money from GCash or
        your bank.
      </p>
      <div className="rounded-[20px] bg-card p-4">
        <CreditLineForm />
      </div>
    </div>
  );
}
