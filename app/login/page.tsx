import { Suspense } from "react";

export default function LoginPage() {
  return <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6">
    <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">Sign in to OpenDashboards</h1>
      <p className="mt-2 text-sm text-muted-foreground">Use your deployment’s operator password.</p>
      <Suspense><LoginForm /></Suspense>
    </div>
  </main>;
}

async function LoginForm() {
  const { connection } = await import("next/server");
  await connection();
  return <form action="/auth/login" method="post" className="mt-6 flex flex-col gap-4">
    <label className="text-sm font-medium">Password
      <input type="password" name="password" required autoComplete="current-password" maxLength={1024}
        className="mt-2 w-full rounded-md border px-3 py-2" />
    </label>
    <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">Sign in</button>
  </form>;
}
