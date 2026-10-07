export type MongoConnectionIssue = "dns" | "network" | "authentication" | "unknown";

const safeMessages: Record<MongoConnectionIssue, string> = {
  dns: "MongoDB Atlas could not be found through DNS. Check your internet, VPN or firewall, and DNS settings, then try again.",
  network: "MongoDB Atlas is temporarily unreachable. Check that the cluster is running and your network can reach it, then try again.",
  authentication: "MongoDB rejected the database credentials. Check the server-side username, password, and URI encoding.",
  unknown: "The database is temporarily unavailable. Please try again shortly.",
};

export class MongoConnectionError extends Error {
  readonly issue: MongoConnectionIssue;
  readonly userMessage: string;

  constructor(issue: MongoConnectionIssue, cause: unknown) {
    super(safeMessages[issue], { cause });
    this.name = "MongoConnectionError";
    this.issue = issue;
    this.userMessage = safeMessages[issue];
  }
}

function getErrorChain(error: unknown): Array<{ code?: unknown; codeName?: unknown; name?: unknown; message?: unknown }> {
  const chain: Array<{ code?: unknown; codeName?: unknown; name?: unknown; message?: unknown }> = [];
  const visited = new Set<object>();
  const pending: unknown[] = [error];

  while (pending.length > 0 && chain.length < 12) {
    const current = pending.shift();
    if (typeof current !== "object" || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const candidate = current as {
      code?: unknown;
      codeName?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
      reason?: unknown;
    };
    chain.push(candidate);
    pending.push(candidate.cause, candidate.reason);
  }

  return chain;
}

export function toMongoConnectionError(error: unknown): MongoConnectionError | null {
  if (error instanceof MongoConnectionError) {
    return error;
  }

  const chain = getErrorChain(error);
  const names = chain.map((item) => String(item.name ?? "").toLowerCase());
  const codes = chain.map((item) => String(item.code ?? "").toUpperCase());
  const codeNames = chain.map((item) => String(item.codeName ?? "").toLowerCase());
  const messages = chain.map((item) => String(item.message ?? "").toLowerCase());

  if (
    messages.some((message) => message.includes("querysrv")) ||
    codes.some((code) => ["ENOTFOUND", "EAI_AGAIN"].includes(code))
  ) {
    return new MongoConnectionError("dns", error);
  }

  if (
    codes.includes("18") ||
    codeNames.includes("authenticationfailed") ||
    messages.some((message) => message.includes("authentication failed"))
  ) {
    return new MongoConnectionError("authentication", error);
  }

  if (
    names.some((name) => name.includes("mongoserverselection")) ||
    codes.some((code) => ["ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ECONNREFUSED"].includes(code))
  ) {
    return new MongoConnectionError("network", error);
  }

  return null;
}
