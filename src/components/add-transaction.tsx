import { TransactionForm, type Prefill } from "@/components/transaction-form";
import { isCategoryFor } from "@/lib/categories";
import { getAccounts, getPeople, getSubcategories, getTransactions, templatesFrom } from "@/lib/data";
import { today } from "@/lib/dates";
import { parseAmount } from "@/lib/money";

type Params = Record<string, string | string[] | undefined>;

/**
 * Reads `?type=income&amount=…&category=…&account=…&note=…&link=…`, which
 * scheduled items use to open Add filled in. `?account=…` alone (a wallet's
 * + Add) just picks the wallet.
 */
function prefillFrom(params: Params): Prefill | undefined {
  const get = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
  const type = get("type");
  // From a wallet's + Add: just the wallet, as an expense to start.
  if (!type && get("account")) {
    return { type: "expense", amount: null, category: null, accountId: get("account"), note: "", link: null };
  }
  if (type !== "expense" && type !== "income") return undefined;
  const amount = parseAmount(get("amount"));
  const category = get("category");
  const link = get("link");
  return {
    type,
    amount: amount > 0 ? amount : null,
    category: isCategoryFor(type, category) ? category : null,
    accountId: get("account") || null,
    note: get("note").slice(0, 120),
    link: /^[0-9a-f-]{36}\|\d{4}-\d{2}-\d{2}$/i.test(link) ? link : null,
  };
}

// Loads wallets and recent templates for Add. Reads the session, so render
// it inside <Suspense>.
export async function AddTransaction({
  mode,
  searchParams,
}: {
  mode: "modal" | "page";
  searchParams?: Promise<Params>;
}) {
  const [accounts, recent, people, subcategories, params] = await Promise.all([
    getAccounts(),
    getTransactions({ limit: 60 }),
    getPeople(),
    getSubcategories(),
    searchParams ?? Promise.resolve<Params>({}),
  ]);
  const templates = templatesFrom(recent, new Set(accounts.map((a) => a.id)));

  return (
    <TransactionForm
      accounts={accounts}
      templates={templates}
      today={today()}
      mode={mode}
      prefill={prefillFrom(params)}
      people={people.map((p) => ({ id: p.id, name: p.name, balance: p.balance }))}
      startSplit={params.split === "1"}
      subcategories={subcategories}
    />
  );
}

export function AddTransactionSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 p-5 lg:flex-row lg:gap-7 lg:p-7">
      <div className="h-[420px] flex-1 rounded-[22px] bg-line-soft" />
      <div className="hidden h-[420px] flex-1 rounded-[22px] bg-line-soft lg:block" />
    </div>
  );
}
