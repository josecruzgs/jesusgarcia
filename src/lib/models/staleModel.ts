import mongoose, { models } from "mongoose";

/**
 * El dev server cachea el modelo ya compilado entre recargas, así que un schema
 * viejo sobrevive a los cambios del archivo que lo define. Con un campo nuevo
 * eso no da error: mongoose simplemente lo descarta al guardar, y el documento
 * queda sin él. Descartando el caché cuando falta alguno de `paths`, la próxima
 * recarga recompila el schema de cero.
 *
 * Task y Campaign traen su propia versión de esto porque además miran los
 * valores del enum `type`, no solo qué campos existen.
 */
export function dropStaleModel(name: string, paths: string[]) {
  const schema = models[name]?.schema;
  if (!schema) return;
  if (paths.some((path) => !schema.path(path))) mongoose.deleteModel(name);
}
