require('dotenv').config();
const chokidar = require('chokidar');
const { spawn } = require('child_process');

const INDEX_FOLDER = process.env.INDEX_FOLDER || 'kb';

let running = false;
let pending = false;

function runIndex(){
  if (running) { pending = true; return; }
  running = true;
  console.log("🔄 Reindexando...");
  const p = spawn(process.execPath, ['scripts/index_drive.js'], { stdio: 'inherit' });
  p.on('close', () => {
    running = false;
    if (pending) { pending = false; runIndex(); }
  });
}

console.log("👀 Monitorando alterações em:", INDEX_FOLDER);
const watcher = chokidar.watch(INDEX_FOLDER, { ignoreInitial: true, persistent: true });
watcher.on('add', runIndex);
watcher.on('change', runIndex);
watcher.on('unlink', runIndex);
watcher.on('addDir', runIndex);
watcher.on('unlinkDir', runIndex);

runIndex();
