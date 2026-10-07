import { NextResponse } from "next/server";

export function successJson(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { success: true, ...data },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function errorJson(error: string, status = 400, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  return NextResponse.json(
    { success: false, error },
    { status, headers: responseHeaders },
  );
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function logApiError(scope: string, error: unknown) {
  const secrets = [
    process.env.MONGODB_URI,
    process.env.AUTH_SECRET,
    process.env.INITIAL_SETUP_TOKEN,
    process.env.CLOUDINARY_API_KEY,
    process.env.CLOUDINARY_API_SECRET,
    process.env.B2_APPLICATION_KEY_ID,
    process.env.B2_APPLICATION_KEY,
  ].filter((secret): secret is string => Boolean(secret));
  const errorDetails = error && typeof error === "object"
    ? error as Record<string, unknown>
    : undefined;
  const nestedError = errorDetails?.error && typeof errorDetails.error === "object"
    ? errorDetails.error as Record<string, unknown>
    : undefined;
  let message = error instanceof Error
    ? error.message
    : typeof nestedError?.message === "string"
      ? nestedError.message
      : typeof errorDetails?.message === "string"
        ? errorDetails.message
        : typeof errorDetails?.error === "string"
          ? errorDetails.error
          : "A non-Error value was thrown.";
  for (const secret of secrets) message = message.replaceAll(secret, "[REDACTED]");

  const code =
    nestedError?.http_code ?? errorDetails?.http_code ?? errorDetails?.code
      ? String(nestedError?.http_code ?? errorDetails?.http_code ?? errorDetails?.code).slice(0, 80)
      : undefined;
  console.error(`[${scope}] Request failed`, {
    name: error instanceof Error ? error.name : typeof error,
    ...(code ? { code } : {}),
    message: message.slice(0, 500),
  });
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let result: T;
  try {
    result = JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an invalid response."
        : `The request failed (${response.status}) and the server returned no readable error.`,
    );
  }
  if (!response.ok) {
    const payload = result as { error?: string };
    throw new Error(payload.error ?? `The request failed (${response.status}).`);
  }
  return result;
}
