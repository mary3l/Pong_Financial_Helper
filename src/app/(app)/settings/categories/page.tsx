import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getUserCategories } from "@/lib/data";
import { CategoryManager } from "./category-manager";

export const metadata = { title: "Categories · Pong Money" };

// Settings › Categories: add your own beside Food, Transpo, Salary and the
// rest, with a name, icon and colour. See 0027_user_categories.sql.
export default function CategoriesPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl">
      <Link href="/settings" className="flex h-10 w-fit items-center font-extrabold text-sea-dark">
        ‹ Settings
      </Link>
      <h1 className="font-display text-3xl font-semibold">Categories</h1>
      <Suspense fallback={<div className="h-80 rounded-[20px] bg-line-soft" />}>
        <Categories />
      </Suspense>
    </div>
  );
}

async function Categories() {
  await connection();
  return <CategoryManager custom={await getUserCategories()} />;
}
