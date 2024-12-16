import express from "express";
import logger from "morgan";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";

import { Server } from "socket.io";
import { createServer } from "node:http";

dotenv.config();

const port = process.env.PORT ?? 5000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});

const db = createClient({
  url: "libsql://fancy-black-queen-markjoaquin1.turso.io",
  authToken: process.env.DB_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    user TEXT,
    image TEXT
  )
`);

io.on("connection", async (socket) => {
  console.log("a user has connected!");

  socket.on("disconnect", () => {
    console.log("an user has disconnected");
  });

  socket.on("chat message", async (msg) => {
    let result;
    const username = socket.handshake.auth.username ?? "anonymous";
    console.log({ username });
    try {
      result = await db.execute({
        sql: "INSERT INTO messages (content, user) VALUES (:msg, :username)",
        args: { msg, username },
      });
    } catch (e) {
      console.error(e);
      return;
    }

    io.emit("chat message", msg, result.lastInsertRowid.toString(), username);
  });

  // Manejar imágenes (Base64 en este caso)
  socket.on("chat-image", async (data) => {
    let result;
    const username = socket.handshake.auth.username ?? "anonymous";

    try {
      result = await db.execute({
        sql: "INSERT INTO messages (content, user, image) VALUES (:msg, :username, :image)",
        args: { msg: "", username, image: data },
      });
      io.emit("chat-image", data, result.lastInsertRowid.toString(), username); // Reenviar a todos los clientes
    } catch (e) {
      console.error(e);
      return;
    }
  });

  if (!socket.recovered) {
    // <- recuperase los mensajes sin conexión
    try {
      const results = await db.execute({
        sql: "SELECT id, content, user, image FROM messages WHERE id > ?",
        args: [socket.handshake.auth.serverOffset ?? 0],
      });

      results.rows.forEach((row) => {
        if(row.image) {
          socket.emit("chat-image", row.image ,row.id.toString(), row.user);
        }else {
          socket.emit("chat message", row.content, row.id.toString(), row.user);
        }
      });
    } catch (e) {
      console.error(e);
    }
  }
});

app.use(logger("dev"));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/client/index.html");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
