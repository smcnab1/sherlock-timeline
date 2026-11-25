"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.get("password") }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Too many attempts. Try again in 15 minutes."
          : "Authentication failed. Please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not reach the application. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form
      onSubmit={submitLogin}
      className="w-full max-w-sm rounded-md border border-slate-800 bg-slate-900 p-6 shadow-2xl"
    >
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-sky-400 text-slate-950">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Sherlock</h1>
          <p className="text-sm text-slate-400">Administrator access</p>
        </div>
      </div>

      <label className="block text-sm font-medium text-slate-200" htmlFor="password">
        Password
      </label>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        className="mt-2"
        disabled={isLoading}
        required
      />

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <Button type="submit" className="mt-5 w-full" disabled={isLoading}>
        {isLoading ? "Signing in..." : "Login"}
      </Button>
    </form>
  );
}
