/**
 * Error de la API que conserva el cuerpo de la respuesta.
 *
 * Algunos rechazos traen más que un texto —qué le falta al pedido, o qué
 * alternativa hay— y con un `Error` pelado eso se perdía en el camino.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // el servidor no devolvió JSON (ej. página de error HTML de Next)
  }

  // La sesión vence a los treinta días y puede caducar con la pestaña abierta.
  // Sin esto, cada acción quedaba en un "No autenticado" suelto en pantalla sin
  // decir qué hacer; ahora se vuelve al login conservando a dónde iba.
  if (res.status === 401 && typeof window !== "undefined") {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
  }

  if (!res.ok) {
    const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const message = "error" in body ? String(body.error) : `Error ${res.status} en ${path}`;
    throw new ApiError(message, res.status, body);
  }

  return json as T;
}
