import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

export const USER_ROLES = ["admin", "operador"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Apariencia y hora local, por usuario.
 *
 * Todo vacío significa "lo de la casa": el oro, el fondo original del menú, el
 * logo y los textos por defecto. Así un usuario nuevo ve el panel tal como
 * estaba y solo cambia lo que toca a propósito.
 */
const PreferencesSchema = new Schema(
  {
    /** Hex del acento personal. Reemplaza el oro, no los cuatro elementos. */
    accentColor: { type: String, default: "" },
    /** Hex del tinte del menú lateral. Se aplica como velo, no como relleno. */
    sidebarColor: { type: String, default: "" },
    /** Clave de ciudad de src/lib/timezones.ts (de ahí salen zona y etiqueta). */
    city: { type: String, default: "" },
    /** Foto de perfil como data URI; sustituye al logo en el menú. */
    avatar: { type: String, default: "" },
    brandTitle: { type: String, default: "" },
    brandSubtitle: { type: String, default: "" },
  },
  { _id: false },
);

export type Preferences = InferSchemaType<typeof PreferencesSchema>;

export const EMPTY_PREFERENCES: Preferences = {
  accentColor: "",
  sidebarColor: "",
  city: "",
  avatar: "",
  brandTitle: "",
  brandSubtitle: "",
};

const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Formato "scrypt$salt$hash" — ver src/lib/auth/password.ts.
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: "operador" },
    // group_id de AdsPower a los que este usuario tiene acceso. El admin los ve
    // todos y este campo se le ignora.
    groupIds: { type: [String], default: [] },
    // Dar de baja en vez de borrar: las campañas y tareas del usuario siguen
    // existiendo con su ownerId y quedarían huérfanas.
    active: { type: Boolean, default: true },
    preferences: { type: PreferencesSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export type User = InferSchemaType<typeof UserSchema>;

/**
 * Forma en que un usuario sale del servidor. Se arma campo por campo y no
 * quitando `passwordHash` de un spread: así un campo sensible que se agregue
 * mañana al schema no se filtra solo por haberlo agregado.
 */
export function toPublicUser(user: {
  _id: unknown;
  username: string;
  role: UserRole;
  groupIds?: string[];
  active?: boolean;
}) {
  return {
    _id: String(user._id),
    username: user.username,
    role: user.role,
    groupIds: user.groupIds ?? [],
    active: user.active !== false,
  };
}

dropStaleModel("User", ["preferences"]);

export default models.User ?? model("User", UserSchema);
