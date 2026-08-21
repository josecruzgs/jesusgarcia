import { config } from "dotenv";
config({ path: ".env.local" });

import mongoose from "mongoose";
import { dbConnect } from "../lib/mongodb";
import UserModel from "../lib/models/User";
import CampaignModel from "../lib/models/Campaign";
import TaskModel from "../lib/models/Task";
import DashboardModel from "../lib/models/Dashboard";
import PostModel from "../lib/models/Post";
import CommentModel from "../lib/models/Comment";
import ListeningProjectModel from "../lib/models/ListeningProject";
import { hashPassword, passwordProblem } from "../lib/auth/password";

/**
 * Crea el usuario administrador y le adopta todo lo que ya existía.
 *
 * Antes de que hubiera usuarios, campañas, tareas, dashboards, bancos de textos
 * y proyectos de escucha no tenían dueño. Ahora `ownerId` es obligatorio, así
 * que lo viejo sería invisible para todo el mundo hasta que alguien lo reclame.
 * Este script lo pone a nombre del admin, que después puede repartirlo.
 *
 * Es idempotente: si el usuario ya existe no se toca (salvo que se pase
 * --reset-password), y la adopción solo alcanza a lo que todavía no tiene dueño.
 *
 *   npm run users:admin -- --username jose --password "una-larga"
 *   npm run users:admin -- --username jose --password "otra" --reset-password
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const RESET_PASSWORD = process.argv.includes("--reset-password");

// Las seis colecciones que ganaron ownerId.
const OWNED = [
  { model: CampaignModel, label: "campañas" },
  { model: TaskModel, label: "tareas" },
  { model: DashboardModel, label: "dashboards" },
  { model: PostModel, label: "publicaciones" },
  { model: CommentModel, label: "comentarios" },
  { model: ListeningProjectModel, label: "proyectos de escucha" },
] as const;

async function main() {
  const username = (arg("username") ?? "").trim().toLowerCase();
  const password = arg("password") ?? "";

  if (!username || !password) {
    console.error("Uso: npm run users:admin -- --username <usuario> --password <contraseña>");
    process.exit(1);
  }

  const problem = passwordProblem(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  await dbConnect();

  let admin = await UserModel.findOne({ username });

  if (!admin) {
    admin = await UserModel.create({
      username,
      passwordHash: await hashPassword(password),
      role: "admin",
      groupIds: [],
      active: true,
    });
    console.log(`Usuario "${username}" creado como administrador.`);
  } else {
    // Reactivar y devolver el rol admin: si se corre este script es
    // justamente porque hace falta un administrador que pueda entrar.
    admin.role = "admin";
    admin.active = true;
    if (RESET_PASSWORD) admin.passwordHash = await hashPassword(password);
    await admin.save();
    console.log(
      `Usuario "${username}" ya existía: queda como administrador activo` +
        `${RESET_PASSWORD ? " y con la contraseña nueva" : " (la contraseña no se tocó, usá --reset-password)"}.`,
    );
  }

  console.log("\nAdopción de lo que no tenía dueño:");
  for (const { model, label } of OWNED) {
    const { modifiedCount } = await model.updateMany(
      { ownerId: { $exists: false } },
      { $set: { ownerId: admin._id } },
    );
    console.log(`  ${String(modifiedCount).padStart(6)}  ${label}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
