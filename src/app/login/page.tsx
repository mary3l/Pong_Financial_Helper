import { SignInHero } from "./hero";

export const metadata = {
  title: "Sign in · Pong Money",
  description:
    "Sign in to Pong Money, the free budget app for paydays, bills, utang and groceries in the Philippines.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return (
    <main>
      <SignInHero
        intro={
          <>
            I&apos;ll watch your bills, paydays and pautang, and tell you how much you can safely
            spend each day.
          </>
        }
      />
    </main>
  );
}
