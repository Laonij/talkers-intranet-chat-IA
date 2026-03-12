require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");
const { kbDir } = require("../db");

const FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const SA_JSON = process.env.DRIVE_SERVICE_ACCOUNT_JSON;
const MANAGED_FILE_RE = /__[a-f0-9]{10}(\.[^.]+)?$/i;

function fatal(message) {
  console.error(message);
  process.exit(1);
}

function safeName(name) {
  return String(name || "arquivo").replace(/[\\/:*?"<>|]/g, "_");
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function getOutputPath(name, fileId, ext) {
  const tag = sha1(fileId).slice(0, 10);
  return path.join(kbDir, `${safeName(name)}__${tag}${ext || ""}`);
}

function shouldDownload(outPath, modifiedMs) {
  if (!fs.existsSync(outPath)) return true;
  if (!modifiedMs) return false;

  const stat = fs.statSync(outPath);
  return Math.abs(Number(stat.mtimeMs) - Number(modifiedMs)) > 1000;
}

function markFileTime(outPath, modifiedMs) {
  if (!modifiedMs || !Number.isFinite(modifiedMs)) return;
  const when = new Date(modifiedMs);
  fs.utimesSync(outPath, when, when);
}

async function writeResponseStream(streamResponse, outPath, modifiedMs) {
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    streamResponse.data.on("error", reject).pipe(writer);
    writer.on("finish", resolve).on("error", reject);
  });

  markFileTime(outPath, modifiedMs);
}

function cleanupStaleManagedFiles(expectedPaths) {
  const existing = fs
    .readdirSync(kbDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(kbDir, entry.name))
    .filter((fullPath) => MANAGED_FILE_RE.test(path.basename(fullPath)));

  let removed = 0;
  for (const fullPath of existing) {
    if (expectedPaths.has(fullPath)) continue;
    fs.unlinkSync(fullPath);
    removed++;
  }

  return removed;
}

async function downloadDriveFile(drive, file, expectedPaths) {
  const id = file.id;
  const name = file.name || "arquivo";
  const mime = file.mimeType || "";
  const modifiedMs = file.modifiedTime ? Date.parse(file.modifiedTime) : 0;
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
      return { downloaded: 0, skipped: 1 };
    }

    const outPath = getOutputPath(name, id, ext);
    expectedPaths.add(outPath);

    if (!shouldDownload(outPath, modifiedMs)) {
      return { downloaded: 0, skipped: 1 };
    }

    const stream = await drive.files.export(
      { fileId: id, mimeType: exportMime },
      { responseType: "stream" }
    );
    await writeResponseStream(stream, outPath, modifiedMs);
    return { downloaded: 1, skipped: 0 };
  }

  const ext = path.extname(name) || "";
  const outPath = getOutputPath(name, id, ext);
  expectedPaths.add(outPath);

  if (!shouldDownload(outPath, modifiedMs)) {
    return { downloaded: 0, skipped: 1 };
  }

  const stream = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "stream" });
  await writeResponseStream(stream, outPath, modifiedMs);
  return { downloaded: 1, skipped: 0 };
}

async function main() {
  if (!FOLDER_ID) fatal("DRIVE_FOLDER_ID vazio.");
  if (!SA_JSON) fatal("DRIVE_SERVICE_ACCOUNT_JSON vazio.");

  let creds;
  try {
    creds = JSON.parse(SA_JSON);
  } catch {
    fatal("DRIVE_SERVICE_ACCOUNT_JSON invalido (nao e JSON).");
  }

  fs.mkdirSync(kbDir, { recursive: true });

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  console.log("Sync Drive -> KB:", kbDir);

  const expectedPaths = new Set();
  const q = `'${FOLDER_ID}' in parents and trashed=false`;
  let pageToken = null;
  let downloaded = 0;
  let skipped = 0;

  do {
    const response = await drive.files.list({
      q,
      pageSize: 1000,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken: pageToken || undefined,
    });

    const files = response.data.files || [];
    for (const file of files) {
      const result = await downloadDriveFile(drive, file, expectedPaths);
      downloaded += result.downloaded;
      skipped += result.skipped;
    }

    pageToken = response.data.nextPageToken || null;
  } while (pageToken);

  const removed = cleanupStaleManagedFiles(expectedPaths);

  console.log("Sync finalizado. Baixados/atualizados:", downloaded, "Pulados:", skipped, "Removidos:", removed);
  console.log("Agora rode: npm run index");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});