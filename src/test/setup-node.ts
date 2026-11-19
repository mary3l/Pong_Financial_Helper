import { vi } from "vitest";

// `import "server-only"` throws outside a React Server Components bundle.
// Server Action tests import that code directly, so make it a no-op.
vi.mock("server-only", () => ({}));
