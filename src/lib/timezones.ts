/**
 * Ciudades donde opera la sala, con su zona horaria real.
 *
 * Se guarda la CIUDAD y no la zona porque no son lo mismo: Mexicali y Tijuana
 * comparten `America/Tijuana`, pero quien está en Mexicali quiere leer
 * "MEXICALI" en la barra, no el nombre de la zona. La zona sale de acá.
 *
 * Sonora no aplica horario de verano y Baja California sí, así que en verano
 * Hermosillo y Tijuana marcan la misma hora y en invierno se separan una. Ese
 * desfase es justamente lo que el reloj de la barra deja ver de un vistazo.
 */
export type City = {
  key: string;
  label: string;
  timeZone: string;
  state: string;
};

export const CITIES: City[] = [
  { key: "hermosillo", label: "Hermosillo", timeZone: "America/Hermosillo", state: "Sonora" },
  { key: "obregon", label: "Ciudad Obregón", timeZone: "America/Hermosillo", state: "Sonora" },
  { key: "nogales", label: "Nogales", timeZone: "America/Hermosillo", state: "Sonora" },
  { key: "tijuana", label: "Tijuana", timeZone: "America/Tijuana", state: "Baja California" },
  { key: "mexicali", label: "Mexicali", timeZone: "America/Tijuana", state: "Baja California" },
  { key: "ensenada", label: "Ensenada", timeZone: "America/Tijuana", state: "Baja California" },
  { key: "laspaz", label: "La Paz", timeZone: "America/Mazatlan", state: "Baja California Sur" },
  { key: "culiacan", label: "Culiacán", timeZone: "America/Mazatlan", state: "Sinaloa" },
  { key: "chihuahua", label: "Chihuahua", timeZone: "America/Chihuahua", state: "Chihuahua" },
  { key: "cdmx", label: "Ciudad de México", timeZone: "America/Mexico_City", state: "CDMX" },
  { key: "monterrey", label: "Monterrey", timeZone: "America/Monterrey", state: "Nuevo León" },
  { key: "cancun", label: "Cancún", timeZone: "America/Cancun", state: "Quintana Roo" },
];

export const DEFAULT_CITY = CITIES[0];

export function findCity(key: string | undefined | null): City {
  return CITIES.find((c) => c.key === key) ?? DEFAULT_CITY;
}
