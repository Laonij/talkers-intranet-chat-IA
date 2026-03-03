\
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");
const { kbDir } = require("../db");

const FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const SA_JSON = process.env.DRIVE_SERVICE_ACCOUNT_JSON;

function fatal(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function safeName(name) {
  return String(name || "arquivo").replace(/[\\\/:*?"<>|]/g, "_");
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

async function main() {
  if (!FOLDER_ID) fatal("DRIVE_FOLDER_ID vazio.");
  if (!SA_JSON) fatal("DRIVE_SERVICE_ACCOUNT_JSON vazio.");

  let creds;
  try {
    creds = JSON.parse(SA_JSON);
  } catch {
    fatal("DRIVE_SERVICE_ACCOUNT_JSON inválido (não é JSON).");
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  console.log("📥 Sync Drive → KB:", kbDir);

  const q = `'${FOLDER_ID}' in parents and trashed=false`;
  let pageToken = null;
  let downloaded = 0;
  let skipped = 0;

  do {
    const resp = await drive.files.list({
      q,
      pageSize: 1000,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken: pageToken || undefined,
    });

    const files = resp.data.files || [];
    for (const f of files) {
      const id = f.id;
      const name = safeName(f.name);
      const mime = f.mimeType || "";
      const tag = sha1(id).slice(0, 10);

      const isGoogle = mime.startsWith("application/vnd.google-apps.");

      if (isGoogle) {
        let exportMime = null;
        let ext = "";
        if (mime === "application/vnd.google-apps.document") {
          exportMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          ext = ".docx";
        } else if (mime === "application/vnd.google-apps.spreadsheet") {
          exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          ext = ".xlsx";
        } else if (mime === "application/vnd.google-apps.presentation") {
          exportMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          ext = ".pptx";
        } else {
          skipped++;
          continue;
        }

        const outPath = path.join(kbDir, `${name}__${tag}${ext}`);
        if (fs.existsSync(outPath)) {
          skipped++;
          continue;
        }

        const stream = await drive.files.export({ fileId: id, mimeType: exportMime }, { responseType: "stream" });
        await new Promise((resolve, reject) => {
          const w = fs.createWriteStream(outPath);
          stream.data.on("error", reject).pipe(w);
          w.on("finish", resolve).on("error", reject);
        });

        downloaded++;
        continue;
      }

      const ext = path.extname(name) || "";
      const outPath = path.join(kbDir, `${name}__${tag}${ext}`);
      if (fs.existsSync(outPath)) {
        skipped++;
        continue;
      }

      const stream = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "stream" });
      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(outPath);
        stream.data.on("error", reject).pipe(w);
        w.on("finish", resolve).on("error", reject);
      });

      downloaded++;
    }

    pageToken = resp.data.nextPageToken || null;
  } while (pageToken);

  console.log("✅ Sync finalizado. Baixados:", downloaded, "Pulados:", skipped);
  console.log("Agora rode: npm run index");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
