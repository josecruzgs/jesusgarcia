"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import Image from "next/image";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Usuario o contraseña incorrectos");
      }
      // Recarga completa (no router.push) para que el middleware vuelva a
      // evaluar la request con la cookie recién seteada.
      window.location.href = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      {/* Anillos que se expanden detrás de la tarjeta: la misma cortinilla
          del splash, en reposo, para que el gate ya se sienta parte de la
          sala antes de entrar. */}
      <div className="splash-rings" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="splash-ring"
            style={{ borderColor: "color-mix(in srgb, var(--gold) 30%, transparent)", animationDelay: `${i * 0.8}s` }}
          />
        ))}
      </div>

      <form
        onSubmit={submit}
        className="card-surface animate-fade-in-up relative z-10 flex w-full max-w-sm flex-col gap-4 p-7"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Image src="/media/logoblack.png" alt="Jesús García · USO INTERNO" width={44} height={44} className="object-contain dark:hidden" />
          <Image src="/media/logo.png" alt="Jesús García · USO INTERNO" width={44} height={44} className="hidden object-contain dark:block" />
          <h1 className="font-display mt-1 text-2xl font-semibold tracking-[-0.02em] text-ink">Jesús García</h1>
          <p className="label-mono-sm">Equipo Jesús García · USO INTERNO</p>
          <p className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-secondary">
            <Lock className="h-3.5 w-3.5" /> Ingresa con tu usuario para continuar
          </p>
        </div>

        {error && (
          <p className="rounded-[7px] border border-critical/40 bg-critical/10 p-2 text-center font-mono text-[11px] text-critical">
            {error}
          </p>
        )}

        <input
          autoFocus
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Usuario"
          className="rounded-[9px] border border-hairline bg-page px-3 py-2.5 text-sm outline-none transition-colors focus:border-gold"
        />

        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          className="rounded-[9px] border border-hairline bg-page px-3 py-2.5 text-sm outline-none transition-colors focus:border-gold"
        />

        <button
          disabled={loading || !username || !password}
          className="glow-btn rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="classchip mx-auto mt-1">Equipo Jesús García · USO INTERNO</p>
      </form>
    </div>
  );
}
