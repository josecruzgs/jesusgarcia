/**
 * LA ENCUESTA DE EJEMPLO: OPINIÓN CIUDADANA EN BAJA CALIFORNIA.
 *
 * Es el guion con el que arranca una campaña nueva «en blanco» (ver crearCampana en campanas.ts), para que haya algo que
 * editar. Después el guion de cada campaña vive en Mongo y se cambia en /encuestas/[id]/guion: lo que diga este archivo
 * no pisa lo que haya allá.
 *
 * Es una encuesta de opinión sobre el trabajo de gobierno y los problemas de la colonia: no pregunta por partidos,
 * candidaturas ni intención de voto, y no menciona a ninguna persona.
 *
 * Lo que enseñó el campo:
 * - El saludo corto: con uno largo, buena parte de quienes colgaban lo hacía durante el saludo.
 * - Dos preguntas y las opciones dentro de la pregunta, no más de 4 o 5 leídas: con listas largas la gente cuelga a media lista.
 * - «Regular», «Otro» y «No sabe» se registran pero no se leen: leer «no sabe» como opción hace que más gente lo escoja para no pensar.
 * - La asistente dice que es una asistente virtual: no se hace pasar por persona.
 */
export const ENCUESTA = {
  nombre: "Opinión ciudadana · Baja California",
  municipio: "Baja California",
  saludo: "¡Hola, buen día! Soy una asistente virtual. Le llamo para una encuesta de solo dos preguntas sobre Baja California. ¿Me permite comenzar?",
  cierre: "¡Muchas gracias por participar! Su opinión es muy importante. ¡Que tenga excelente día!",
  preguntas: [
    {
      clave: "gobierno",
      corto: "¿Cómo califica el trabajo del Gobierno del Estado?",
      texto: "¿Cómo califica el trabajo que está haciendo el Gobierno del Estado de Baja California: muy bueno, bueno, malo o muy malo?",
      opciones: ["Muy bueno", "Bueno", "Regular", "Malo", "Muy malo", "No sabe"],
      noSeLeen: ["Regular", "No sabe"],
      reglas: "Si dice «regular» o «más o menos», registras «Regular».\nSi dice que no sabe, que no le consta o no quiere contestar, registras «No sabe».",
    },
    {
      clave: "problema",
      corto: "¿Cuál es el principal problema de su colonia?",
      texto: "¿Cuál es el principal problema en su colonia: inseguridad, agua, calles y baches, alumbrado o recolección de basura?",
      opciones: ["Inseguridad", "Agua", "Calles y baches", "Alumbrado", "Basura", "Otro", "No sabe"],
      noSeLeen: ["Otro", "No sabe"],
      reglas: "Si menciona otro problema (por ejemplo empleo, salud o transporte), registras «Otro».\nSi dice que ninguno, que no sabe o no quiere contestar, registras «No sabe».",
    },
  ],
} as const;

/** Color de cada respuesta en las gráficas: la calificación de verde a rojo; lo demás en grises y verdes azulados. */
export const COLOR_OPCION: Record<string, string> = {
  "Muy bueno": "#1a7f4b",
  Bueno: "#5cb27e",
  Regular: "#b8c2cc",
  Malo: "#e08a3c",
  "Muy malo": "#c43c3c",
  Otro: "#7C8AA5",
  "No sabe": "#C9D1DF",
};
export const COLOR_PERSONA = ["#0f5c6e", "#1f8a7d", "#2a9d8f", "#7fd1c4", "#b9e6df"];
