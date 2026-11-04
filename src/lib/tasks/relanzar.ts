/**
 * Si volver a encolar esta tarea es relanzar un like que ya salió exitoso.
 *
 * Se comparte entre la API (que lo restringe a admin) y la interfaz (que solo
 * le muestra el botón al admin), para que las dos reglas no se separen.
 */
export function esRelanzamientoDeLike(task: { type?: string | null; status?: string | null }) {
  return task.type === "like" && task.status === "success";
}
