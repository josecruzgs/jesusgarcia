export type FacebookCommentTarget = {
  /** El id tal cual viene en el link, ya decodificado por URLSearchParams. */
  commentId: string;
  /** true cuando el link apunta a una respuesta dentro de un hilo. */
  isReply: boolean;
};

/**
 * Facebook no pone el comentario en la ruta sino en el query string: el
 * permalink de un comentario es el del post más `comment_id=…`, y el de una
 * respuesta trae además `reply_comment_id=…`. Cuando vienen los dos, el que
 * identifica al elemento que hay que likear es el de la respuesta — el otro
 * es solo su hilo padre.
 *
 * El id puede ser numérico (`comment_id=1234`) o base64 en los permalinks
 * nuevos (`comment_id=Y29tbWVudDoxMjM0`, con `=` de padding escapado como
 * `%3D` en el link). Aquí se devuelve decodificado; el runner compara contra
 * las dos formas porque el href del DOM puede traer cualquiera de las dos.
 */
export function parseFacebookCommentTarget(rawUrl: string): FacebookCommentTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const reply = url.searchParams.get("reply_comment_id")?.trim();
  if (reply) return { commentId: reply, isReply: true };

  const comment = url.searchParams.get("comment_id")?.trim();
  if (comment) return { commentId: comment, isReply: false };

  return null;
}
