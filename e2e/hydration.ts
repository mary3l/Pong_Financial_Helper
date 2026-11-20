import { expect, type Locator } from "@playwright/test";

/**
 * Waits until React has hydrated this element, so its click and change
 * handlers are attached. The server sends the page fully drawn, and Playwright
 * would otherwise act on it before the JavaScript runs: a click does nothing
 * and a form submits the old-fashioned way. React marks a hydrated element with
 * a `__reactProps$…` key, a test-only peek at its internals.
 */
export async function hydrated(locator: Locator): Promise<Locator> {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps$"))),
      { message: "the page to finish loading its JavaScript" },
    )
    .toBe(true);
  return locator;
}
