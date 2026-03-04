require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { spawn } = require("child_process");

const { migrate, get, all, run, uploadsDir, logEvent } = require("./db");
const { signSession, requireAuth, requireRole } = require("./auth");

const PORT = Number(process.env.PORT || 8080);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "troque-por-um-segredo-grande";

migrate();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function setSessionCookie(req, res, token) {
  const isHttps = (process.env.BASE_URL || '').startsWith('https://') ||
    String(req.headers?.['x-forwarded-proto'] || '').includes('https');
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Intranet Chat rodando em ${BASE_URL}`);
  console.log(`➡️ Login: ${BASE_URL}/login.html`);
});
