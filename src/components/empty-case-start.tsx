"use client";

import { FormEvent, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function EmptyCaseStart() {
  const [error, setError] = useState("");

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        status: "active investigation",
      }),
    });

    if (!response.ok) {
      setError("Could not create the case. Please try again.");
      return;
    }

    window.location.reload();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-100">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Sign out"
        onClick={logout}
        className="absolute right-4 top-4"
      >
        <LogOut className="h-4 w-4" />
      </Button>
      <form
        onSubmit={createCase}
        className="w-full max-w-xl rounded-md border border-slate-800 bg-slate-900 p-6 shadow-2xl"
      >
        <div className="mb-5">
          <h1 className="text-xl font-semibold">Start a fresh Sherlock case</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            No case data is loaded. Create your first case to begin building the chronology,
            evidence register, people map, actions, and reports.
          </p>
        </div>
        <div className="space-y-3">
          <Input name="title" placeholder="Case title" required />
          <Textarea name="description" placeholder="Brief case description" />
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end">
          <Button type="submit">Create case</Button>
        </div>
      </form>
    </main>
  );
}
