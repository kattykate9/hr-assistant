import "server-only";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "hr_session";
export const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

// Every existing server read/action passes the user's session, never an admin credential.
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  if (target.origin !== new URL(API_URL).origin) throw new Error("Unexpected API origin");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const headers = new Headers(init.headers);
  headers.delete("X-Web-Key");
  headers.delete("X-Bot-Key");
  headers.delete("Authorization");
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers, cache: "no-store", redirect: "error" });
}
