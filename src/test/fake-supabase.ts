import { vi } from "vitest";

// A stand-in for the Supabase client that Server Actions get from
// `createClient()`. It keeps rows in memory per table, applies the simple
// filters our actions use (eq, neq, in, is, not-is, gt/gte/lt/lte, ilike, like,
// limit, order), and records every query so tests can assert on writes.
//
//   const db = fakeSupabase({ accounts: [{ id: "w1", type: "cash", ... }] });
//   vi.mocked(createClient).mockResolvedValue(db.client);
//   await saveTransaction(...);
//   expect(db.writes("transactions", "insert")).toEqual([...]);
//
// It's not Postgres: no RLS, no constraints, no triggers. Writes are
// recorded and applied to the in-memory table so a later read sees them.

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Filter = { method: string; args: unknown[] };

export type Query = {
  table: string;
  op: Op;
  payload?: unknown;
  columns?: string;
  filters: Filter[];
  single?: "single" | "maybeSingle";
  options?: unknown;
};

export type Result = { data: unknown; error: { code?: string; message: string } | null };

/** Return a Result to override what a query gets; undefined lets the fake answer. */
export type Responder = (q: Query) => Result | undefined;

let nextId = 1;

function matches(row: Row, f: Filter): boolean {
  const [col, a, b] = f.args as [string, unknown, unknown];
  const v = row[col];
  switch (f.method) {
    case "eq":
      return v === a || (v != null && a != null && String(v) === String(a));
    case "neq":
      return v !== a;
    case "in":
      return (a as unknown[]).includes(v);
    case "is":
      return a === null ? v == null : v === a;
    case "not":
      // .not(col, "is", null)
      return a === "is" ? (b === null ? v != null : v !== b) : true;
    case "gt":
      return (v as number) > (a as number);
    case "gte":
      return (v as number) >= (a as number);
    case "lt":
      return (v as number) < (a as number);
    case "lte":
      return (v as number) <= (a as number);
    case "ilike":
      return String(v ?? "").toLowerCase() === String(a).toLowerCase();
    case "like": {
      // % matches anything; everything else is literal.
      const pattern = String(a)
        .split("%")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${pattern}$`).test(String(v ?? ""));
    }
    default:
      // or(), order(), limit()…: don't narrow.
      return true;
  }
}

export function fakeSupabase(
  seed: Record<string, Row[]> = {},
  { user = { sub: "user-1", email: "me@example.com" } as Row | null } = {},
) {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]),
  );
  const queries: Query[] = [];
  const responders: Responder[] = [];
  const rows = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };

  function run(q: Query): Result {
    for (const r of responders) {
      const out = r(q);
      if (out) return out;
    }
    const where = (row: Row) => q.filters.every((f) => matches(row, f));
    const limit = q.filters.find((f) => f.method === "limit")?.args[0] as number | undefined;
    let data: Row[] = [];
    const table = rows(q.table);

    if (q.op === "select") {
      data = table.filter(where).map((r) => ({ ...r }));
    } else if (q.op === "insert" || q.op === "upsert") {
      const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
      data = list.map((r) => ({ id: `${q.table}-${nextId++}`, ...r }));
      table.push(...data);
    } else if (q.op === "update") {
      data = table.filter(where);
      for (const r of data) Object.assign(r, q.payload as Row);
      data = data.map((r) => ({ ...r }));
    } else if (q.op === "delete") {
      data = table.filter(where);
      tables.set(
        q.table,
        table.filter((r) => !data.includes(r)),
      );
    }
    if (limit !== undefined) data = data.slice(0, limit);
    if (q.single) {
      if (!data.length && q.single === "single")
        return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }

  function builder(table: string) {
    const q: Query = { table, op: "select", filters: [] };
    let recorded = false;
    const b: Record<string, unknown> = {};
    const chain =
      (fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        fn(...args);
        return b;
      };
    b.select = chain((columns) => {
      // insert(...).select("id") keeps the insert.
      if (q.op === "select") q.columns = columns as string | undefined;
    });
    for (const op of ["insert", "update", "upsert"] as const) {
      b[op] = chain((payload, options) => {
        q.op = op;
        q.payload = payload;
        q.options = options;
      });
    }
    b.delete = chain(() => {
      q.op = "delete";
    });
    for (const method of [
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "or",
      "gt",
      "gte",
      "lt",
      "lte",
      "ilike",
      "like",
      "order",
      "limit",
      "range",
      "match",
      "filter",
      "contains",
    ]) {
      b[method] = chain((...args) => q.filters.push({ method, args }));
    }
    b.single = chain(() => (q.single = "single"));
    b.maybeSingle = chain(() => (q.single = "maybeSingle"));
    b.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      if (!recorded) {
        queries.push(q);
        recorded = true;
      }
      try {
        return Promise.resolve(run(q)).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    };
    return b;
  }

  const auth = {
    getClaims: vi.fn(async () => ({ data: user ? { claims: user } : null, error: null })),
    getUser: vi.fn(async () => ({ data: { user: user ? { id: user.sub } : null }, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: null as unknown })),
    refreshSession: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth,
  };

  return {
    // Typed loosely on purpose: actions only see it through createClient().
    client: client as never,
    raw: client,
    auth,
    queries,
    /** The rows a table holds now, after any writes. */
    table: (t: string) => rows(t),
    /** Payloads of every insert/update/upsert to a table (all ops if none given). */
    writes(t: string, op?: Exclude<Op, "select" | "delete">) {
      return queries
        .filter((q) => q.table === t && q.op !== "select" && q.op !== "delete")
        .filter((q) => !op || q.op === op)
        .map((q) => q.payload);
    },
    /** Every query that changed data, as "op table". */
    writeLog: () => queries.filter((q) => q.op !== "select").map((q) => `${q.op} ${q.table}`),
    /** Make some queries answer differently, e.g. fail. Checked in order before the defaults. */
    respond(r: Responder) {
      responders.push(r);
    },
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;

/** A Result for a failed query. */
export const fail = (code = "XX000", message = "boom"): Result => ({
  data: null,
  error: { code, message },
});
