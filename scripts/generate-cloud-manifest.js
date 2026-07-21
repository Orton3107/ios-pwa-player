// Пересобирает cloud-playlist/manifest.json по содержимому cloud-playlist/tracks/.
// Название и исполнитель берутся из ID3-тегов файла, если тегов нет —
// из имени файла. Запускается вручную (`npm run generate:cloud-manifest`)
// и автоматически в CI при пуше новых файлов (см. .github/workflows/cloud-playlist.yml).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOUD_DIR = path.join(__dirname, '..', 'cloud-playlist');
const TRACKS_DIR = path.join(CLOUD_DIR, 'tracks');
const MANIFEST_PATH = path.join(CLOUD_DIR, 'manifest.json');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg']);

const DEFAULT_PLAYLIST_NAME = 'Облако';
const DEFAULT_PLAYLIST_COVER = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=300&h=300&fit=crop';

const titleFromFilename = (filename) => {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  return withoutExt.replace(/[_-]+/g, ' ').trim();
};

const loadExistingManifest = async () => {
  if (!existsSync(MANIFEST_PATH)) {
    return { playlistName: DEFAULT_PLAYLIST_NAME, playlistCover: DEFAULT_PLAYLIST_COVER };
  }
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      playlistName: parsed.playlistName || DEFAULT_PLAYLIST_NAME,
      playlistCover: parsed.playlistCover || DEFAULT_PLAYLIST_COVER,
    };
  } catch {
    return { playlistName: DEFAULT_PLAYLIST_NAME, playlistCover: DEFAULT_PLAYLIST_COVER };
  }
};

const run = async () => {
  const { playlistName, playlistCover } = await loadExistingManifest();

  const entries = existsSync(TRACKS_DIR) ? await readdir(TRACKS_DIR) : [];
  const audioFiles = entries
    .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru'));

  const tracks = [];
  for (const filename of audioFiles) {
    const filePath = path.join(TRACKS_DIR, filename);
    let title = titleFromFilename(filename);
    let artist = '';

    try {
      const { common } = await parseFile(filePath, { duration: false });
      if (common.title) title = common.title;
      if (common.artist) artist = common.artist;
    } catch (err) {
      console.warn(`Не удалось прочитать теги ${filename}: ${err.message}`);
    }

    tracks.push({ file: `tracks/${filename}`, title, artist });
  }

  const manifest = { playlistName, playlistCover, tracks };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(`Манифест обновлён: ${tracks.length} ${tracks.length === 1 ? 'трек' : 'треков'}.`);
};

run().catch((err) => {
  console.error('Не удалось собрать манифест облачного плейлиста:', err);
  process.exit(1);
});
