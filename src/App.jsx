import React, { useState, useEffect, useRef } from 'react';

// Инициализация IndexedDB с поддержкой трех таблиц (плейлисты, треки, настройки)
const DB_NAME = 'MultiPlaylistPlayerDB';
const DB_VERSION = 3;
const PLAYLISTS_STORE = 'playlists';
const TRACKS_STORE = 'tracks';
const SETTINGS_STORE = 'settings';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
        db.createObjectStore(PLAYLISTS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(TRACKS_STORE)) {
        db.createObjectStore(TRACKS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

// Готовые градиентные фоны плеера
const PRESET_BACKGROUNDS = [
  { id: 'indigo', name: 'Индиго', gradient: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 50%, #020617 100%)' },
  { id: 'sunset', name: 'Закат', gradient: 'linear-gradient(135deg, #f97316 0%, #db2777 50%, #4c1d95 100%)' },
  { id: 'ocean', name: 'Океан', gradient: 'linear-gradient(135deg, #0ea5e9 0%, #0f172a 100%)' },
  { id: 'forest', name: 'Лес', gradient: 'linear-gradient(135deg, #059669 0%, #022c22 100%)' },
  { id: 'midnight', name: 'Полночь', gradient: 'linear-gradient(135deg, #334155 0%, #000000 100%)' },
  { id: 'rose', name: 'Роза', gradient: 'linear-gradient(135deg, #fb7185 0%, #581c87 100%)' },
];

// Склонение слова "трек" по числу (1 трек, 2 трека, 5 треков)
const trackWord = (count) => {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'треков';
  if (last > 1 && last < 5) return 'трека';
  if (last === 1) return 'трек';
  return 'треков';
};

// Дефолтные треки для первого запуска приложения
const DEFAULT_TRACKS = [
  {
    title: "Midnight Drive",
    artist: "Lofi Retro Synth",
    cover: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300&h=300&fit=crop",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    isLocal: false
  },
  {
    title: "Ocean Breeze",
    artist: "Chillwave Acoustic",
    cover: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=300&h=300&fit=crop",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    isLocal: false
  }
];

export default function App() {
  // Данные плейлистов и треков
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null); // Просматриваемый плейлист (null = список плейлистов)
  const [currentPlaylistTracks, setCurrentPlaylistTracks] = useState([]); // Песни в просматриваемом плейлисте
  
  // Очередь воспроизведения плеера
  const [playbackQueue, setPlaybackQueue] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  
  // Состояния плеера
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [activeTab, setActiveTab] = useState('player'); // 'player' | 'playlist'

  // Плавный ползунок
  const [sliderValue, setSliderValue] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Создание нового плейлиста
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  // Переименование плейлиста
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamePlaylistId, setRenamePlaylistId] = useState(null);
  const [renamePlaylistName, setRenamePlaylistName] = useState('');

  // Количество треков в каждом плейлисте (для карточек в библиотеке)
  const [trackCounts, setTrackCounts] = useState({});
  // Всплывающее уведомление (например, о пропущенных дублях при загрузке)
  const [uploadNotice, setUploadNotice] = useState('');

  // Фон плеера: { type: 'default' } | { type: 'preset', presetId } | { type: 'custom', imageUrl }
  const [background, setBackground] = useState({ type: 'default' });
  // Защищено ли хранилище от автоматической очистки Safari при простое
  const [storagePersisted, setStoragePersisted] = useState(null);

  const currentTrack = playbackQueue[currentTrackIndex] || null;
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const backgroundFileInputRef = useRef(null);

  // Ссылки на методы для Media Session API (экран блокировки iOS)
  const handleNextRef = useRef(null);
  const handlePrevRef = useRef(null);
  const togglePlayRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const currentTrackIndexRef = useRef(0);
  const isPlayingRef = useRef(false);

  // При первом запуске инициализируем базу, создаем стандартный плейлист,
  // подгружаем сохраненный фон и просим iOS не удалять наши данные при простое
  useEffect(() => {
    setupInitialData();
    loadBackground();
    requestPersistentStorage();
  }, []);

  // Просим браузер пометить хранилище сайта как "постоянное".
  // Без этого Safari может тихо очистить IndexedDB (треки и плейлисты),
  // если приложением не пользовались продолжительное время.
  const requestPersistentStorage = async () => {
    if (!navigator.storage || !navigator.storage.persist) {
      setStoragePersisted(false);
      return;
    }
    try {
      const alreadyPersisted = await navigator.storage.persisted();
      const granted = alreadyPersisted || await navigator.storage.persist();
      setStoragePersisted(granted);
    } catch (err) {
      console.error('Ошибка запроса постоянного хранилища:', err);
      setStoragePersisted(false);
    }
  };

  // Загрузка сохраненного фона плеера
  const loadBackground = async () => {
    const db = await initDB();
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const req = tx.objectStore(SETTINGS_STORE).get('background');

    req.onsuccess = () => {
      const saved = req.result;
      if (!saved || saved.type === 'default') {
        setBackground({ type: 'default' });
      } else if (saved.type === 'custom' && saved.imageBlob) {
        setBackground({ type: 'custom', imageUrl: URL.createObjectURL(saved.imageBlob) });
      } else if (saved.type === 'preset') {
        setBackground({ type: 'preset', presetId: saved.presetId });
      } else {
        setBackground({ type: 'default' });
      }
    };
  };

  // Сброс фона на стандартное поведение (обложка текущего трека)
  const selectDefaultBackground = async () => {
    const db = await initDB();
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key: 'background', type: 'default' });
    tx.oncomplete = () => setBackground({ type: 'default' });
  };

  // Выбор одного из готовых градиентных фонов
  const selectPresetBackground = async (presetId) => {
    const db = await initDB();
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key: 'background', type: 'preset', presetId });
    tx.oncomplete = () => setBackground({ type: 'preset', presetId });
  };

  // Загрузка своего фото в качестве фона
  const handleBackgroundImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const db = await initDB();
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key: 'background', type: 'custom', imageBlob: file });
    tx.oncomplete = () => setBackground({ type: 'custom', imageUrl: URL.createObjectURL(file) });
  };

  const setupInitialData = async () => {
    try {
      const db = await initDB();
      
      // Читаем плейлисты
      const tx = db.transaction(PLAYLISTS_STORE, 'readonly');
      const store = tx.objectStore(PLAYLISTS_STORE);
      const req = store.getAll();

      req.onsuccess = async () => {
        let loadedPlaylists = req.result;

        // Если плейлистов вообще нет, создаем дефолтный "Избранное"
        if (loadedPlaylists.length === 0) {
          const writeTx = db.transaction([PLAYLISTS_STORE, TRACKS_STORE], 'readwrite');
          const pStore = writeTx.objectStore(PLAYLISTS_STORE);
          const tStore = writeTx.objectStore(TRACKS_STORE);

          const defaultPlaylist = {
            name: "Мой первый плейлист",
            cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=300&h=300&fit=crop"
          };

          const addPlaylistReq = pStore.add(defaultPlaylist);
          addPlaylistReq.onsuccess = (e) => {
            const playlistId = e.target.result;
            
            // Добавляем дефолтные треки в этот плейлист
            DEFAULT_TRACKS.forEach(track => {
              tStore.add({
                ...track,
                playlistId: playlistId,
                fileBlob: null // Стриминговые ссылки
              });
            });
          };

          writeTx.oncomplete = () => {
            setupInitialData(); // Перезагружаем
          };
        } else {
          setPlaylists(loadedPlaylists);
          // Автоматически ставим первый плейлист в очередь воспроизведения, чтобы плеер не был пустым
          loadPlaybackQueue(loadedPlaylists[0].id);
          loadTrackCounts();
        }
      };
    } catch (err) {
      console.error("Ошибка базы данных:", err);
    }
  };

  // Считаем количество треков в каждом плейлисте — для отображения на карточках
  const loadTrackCounts = async () => {
    const db = await initDB();
    const tx = db.transaction(TRACKS_STORE, 'readonly');
    const req = tx.objectStore(TRACKS_STORE).getAll();

    req.onsuccess = () => {
      const counts = {};
      req.result.forEach(t => {
        counts[t.playlistId] = (counts[t.playlistId] || 0) + 1;
      });
      setTrackCounts(counts);
    };
  };

  // Загрузка очереди воспроизведения для плеера
  const loadPlaybackQueue = async (playlistId) => {
    const db = await initDB();
    const tx = db.transaction(TRACKS_STORE, 'readonly');
    const store = tx.objectStore(TRACKS_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      // Фильтруем треки по нужному playlistId
      const playlistTracks = req.result
        .filter(t => t.playlistId === playlistId)
        .map(t => {
          let trackUrl = t.url;
          if (t.fileBlob) {
            trackUrl = URL.createObjectURL(t.fileBlob);
          }
          return { ...t, url: trackUrl };
        });

      setPlaybackQueue(playlistTracks);
      setCurrentTrackIndex(0);
    };
  };

  // Загрузка треков для просмотра конкретного плейлиста во вкладке Медиатеки
  const loadPlaylistTracks = async (playlistId) => {
    if (!playlistId) return;
    const db = await initDB();
    const tx = db.transaction(TRACKS_STORE, 'readonly');
    const store = tx.objectStore(TRACKS_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const filtered = req.result
        .filter(t => t.playlistId === playlistId)
        .map(t => {
          let trackUrl = t.url;
          if (t.fileBlob) {
            trackUrl = URL.createObjectURL(t.fileBlob);
          }
          return { ...t, url: trackUrl };
        });
      setCurrentPlaylistTracks(filtered);
    };
  };

  useEffect(() => {
    if (selectedPlaylistId) {
      loadPlaylistTracks(selectedPlaylistId);
    }
  }, [selectedPlaylistId]);

  // Создание нового плейлиста
  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;

    const db = await initDB();
    const tx = db.transaction(PLAYLISTS_STORE, 'readwrite');
    const store = tx.objectStore(PLAYLISTS_STORE);

    const randomCovers = [
      "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=300&h=300&fit=crop",
      "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?q=80&w=300&h=300&fit=crop",
      "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=300&h=300&fit=crop",
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?q=80&w=300&h=300&fit=crop"
    ];
    const randomCover = randomCovers[Math.floor(Math.random() * randomCovers.length)];

    const newPlaylist = {
      name: newPlaylistName,
      cover: randomCover
    };

    store.add(newPlaylist);

    tx.oncomplete = () => {
      setNewPlaylistName('');
      setShowCreateModal(false);
      setupInitialData();
    };
  };

  // Удаление плейлиста со всеми входящими песнями
  const handleDeletePlaylist = async (playlistId) => {
    const db = await initDB();
    
    // 1. Удаляем сам плейлист
    const pTx = db.transaction(PLAYLISTS_STORE, 'readwrite');
    pTx.objectStore(PLAYLISTS_STORE).delete(playlistId);

    // 2. Удаляем все связанные песни
    const tTx = db.transaction(TRACKS_STORE, 'readwrite');
    const tStore = tTx.objectStore(TRACKS_STORE);
    const req = tStore.getAll();
    req.onsuccess = () => {
      req.result.forEach(track => {
        if (track.playlistId === playlistId) {
          tStore.delete(track.id);
        }
      });
    };

    tTx.oncomplete = () => {
      setSelectedPlaylistId(null);
      setupInitialData();
    };
  };

  // Открытие модалки переименования для конкретного плейлиста
  const openRenameModal = (playlist) => {
    if (!playlist) return;
    setRenamePlaylistId(playlist.id);
    setRenamePlaylistName(playlist.name);
    setShowRenameModal(true);
  };

  // Сохранение нового названия плейлиста
  const handleRenamePlaylist = async () => {
    const trimmed = renamePlaylistName.trim();
    if (!trimmed || !renamePlaylistId) return;

    const db = await initDB();
    const tx = db.transaction(PLAYLISTS_STORE, 'readwrite');
    const store = tx.objectStore(PLAYLISTS_STORE);
    const req = store.get(renamePlaylistId);

    req.onsuccess = () => {
      const playlist = req.result;
      if (playlist) {
        store.put({ ...playlist, name: trimmed });
      }
    };

    tx.oncomplete = () => {
      setShowRenameModal(false);
      setRenamePlaylistId(null);
      setRenamePlaylistName('');
      setupInitialData();
    };
  };

  // Загрузка песен во вкладку открытого плейлиста
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !selectedPlaylistId) return;

    const db = await initDB();

    // Собираем уже существующие в плейлисте треки, чтобы не добавлять дубли.
    // Дублем считаем трек с тем же названием файла и тем же размером —
    // этого достаточно, чтобы отличить повторную загрузку той же песни.
    const existingTracks = await new Promise((resolve) => {
      const req = db.transaction(TRACKS_STORE, 'readonly').objectStore(TRACKS_STORE).getAll();
      req.onsuccess = () => resolve(req.result.filter(t => t.playlistId === selectedPlaylistId));
    });
    const seenKeys = new Set(existingTracks.map(t => `${t.title}::${t.fileBlob?.size || 0}`));

    let skipped = 0;

    for (const file of files) {
      if (file.name.startsWith('.')) continue;
      const title = file.name.replace(/\.[^/.]+$/, "");
      const key = `${title}::${file.size}`;

      if (seenKeys.has(key)) {
        skipped++;
        continue;
      }
      seenKeys.add(key);

      const newTrackData = {
        playlistId: selectedPlaylistId,
        title: title,
        artist: 'Файлы iPhone',
        fileBlob: file,
        cover: playlists.find(p => p.id === selectedPlaylistId)?.cover || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=300&h=300&fit=crop',
        isLocal: true
      };

      const transaction = db.transaction(TRACKS_STORE, 'readwrite');
      transaction.objectStore(TRACKS_STORE).add(newTrackData);
    }

    loadPlaylistTracks(selectedPlaylistId);
    loadTrackCounts();

    if (skipped > 0) {
      setUploadNotice(`Пропущено ${skipped} ${trackWord(skipped)} — уже есть в плейлисте`);
      setTimeout(() => setUploadNotice(''), 3500);
    }
  };

  // Удаление песни из плейлиста
  const handleDeleteTrack = async (trackId, e) => {
    e.stopPropagation();
    const db = await initDB();
    const transaction = db.transaction(TRACKS_STORE, 'readwrite');
    transaction.objectStore(TRACKS_STORE).delete(trackId);

    transaction.oncomplete = () => {
      loadPlaylistTracks(selectedPlaylistId);
      // Если удаленный трек играл прямо сейчас, обновляем очередь плеера
      loadPlaybackQueue(selectedPlaylistId);
      loadTrackCounts();
    };
  };

  // Запуск проигрывания конкретной песни из плейлиста
  const playTrackFromPlaylist = async (playlistId, index) => {
    // Устанавливаем играющую очередь из этого плейлиста
    const db = await initDB();
    const tx = db.transaction(TRACKS_STORE, 'readonly');
    const store = tx.objectStore(TRACKS_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const playlistTracks = req.result
        .filter(t => t.playlistId === playlistId)
        .map(t => {
          let trackUrl = t.url;
          if (t.fileBlob) {
            trackUrl = URL.createObjectURL(t.fileBlob);
          }
          return { ...t, url: trackUrl };
        });

      setPlaybackQueue(playlistTracks);
      setCurrentTrackIndex(index);
      setIsPlaying(true);
      setActiveTab('player');
    };
  };

  // Переключение треков вперед/назад
  const handleNext = () => {
    const queue = playbackQueueRef.current;
    if (queue.length <= 1) return;
    const newIndex = (currentTrackIndexRef.current + 1) % queue.length;
    setCurrentTrackIndex(newIndex);
    setIsPlaying(true);
  };

  const handlePrev = () => {
    const queue = playbackQueueRef.current;
    if (queue.length <= 1) return;
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
    } else {
      const newIndex = (currentTrackIndexRef.current - 1 + queue.length) % queue.length;
      setCurrentTrackIndex(newIndex);
    }
    setIsPlaying(true);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    const currentlyPlaying = isPlayingRef.current;
    if (currentlyPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.log("Ошибка воспроизведения:", err));
    }
  };

  // Обновление рефов для Media Session
  useEffect(() => {
    handleNextRef.current = handleNext;
    handlePrevRef.current = handlePrev;
    togglePlayRef.current = togglePlay;
  }, [playbackQueue, currentTrackIndex, isPlaying]);
  
  // Синхронизация refs с state
  useEffect(() => {
    playbackQueueRef.current = playbackQueue;
    currentTrackIndexRef.current = currentTrackIndex;
    isPlayingRef.current = isPlaying;
  }, [playbackQueue, currentTrackIndex, isPlaying]);

  // Плавный ползунок времени
  useEffect(() => {
    if (!isDragging) {
      setSliderValue(currentTime);
    }
  }, [currentTime, isDragging]);

  // Создаем единственный <audio> элемент один раз при монтировании.
  // ВАЖНО: iOS Safari разрешает автоматический play() без нового жеста
  // пользователя только для элемента, который уже воспроизводился —
  // если при смене трека пересоздавать Audio(), на заблокированном
  // экране браузер молча блокирует play() и трек "зависает" без звука.
  // Поэтому элемент переиспользуется, а при смене трека меняется src.
  //
  // ТАКЖЕ ВАЖНО: элемент создается через new Audio() и существует только
  // в памяти JS, не будучи вставлен в DOM. На iOS это приводит к тому, что
  // аудиосессия при блокировке экрана переходит в "ambient"-режим — время
  // трека продолжает идти, но звук глушится, пока телефон заблокирован,
  // и появляется только после разблокировки. Чтобы iOS считал это полноценным
  // фоновым воспроизведением (со звуком и рабочими кнопками на экране блокировки),
  // элемент нужно реально добавить в документ.
  useEffect(() => {
    const audio = new Audio();
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.preload = 'auto';
    audio.style.position = 'fixed';
    audio.style.width = '0';
    audio.style.height = '0';
    audio.style.opacity = '0';
    audio.style.pointerEvents = 'none';
    document.body.appendChild(audio);
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      // Сообщаем iOS точную позицию/длительность, чтобы экран блокировки
      // не терял синхронизацию с реальным состоянием воспроизведения
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && isFinite(audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        });
      }
    });
    audio.addEventListener('ended', () => handleNextRef.current());

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => togglePlayRef.current());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayRef.current());
      navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevRef.current());
      navigator.mediaSession.setActionHandler('nexttrack', () => handleNextRef.current());
    }

    return () => {
      audio.pause();
      audio.src = '';
      audio.remove();
    };
  }, []);

  // Смена трека: обновляем src того же аудио-элемента вместо пересоздания
  useEffect(() => {
    if (!currentTrack || !audioRef.current) return;
    const audio = audioRef.current;

    audio.pause();
    audio.src = currentTrack.url;
    audio.muted = isMuted;
    audio.load();

    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    }

    // Media Session API (iOS Lock Screen)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: 'iPlayer',
        artwork: [
          { src: currentTrack.cover, sizes: '300x300', type: 'image/jpeg' }
        ]
      });
    }
  }, [currentTrackIndex, playbackQueue]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      if ('setPositionState' in navigator.mediaSession && audioRef.current && isFinite(audioRef.current.duration)) {
        navigator.mediaSession.setPositionState({
          duration: audioRef.current.duration,
          playbackRate: audioRef.current.playbackRate,
          position: audioRef.current.currentTime,
        });
      }
    }
  }, [isPlaying]);

  // Определяем, что показать в качестве заднего фона: свое фото > пресет > обложка трека
  let backgroundStyle = null;
  if (background.type === 'custom' && background.imageUrl) {
    backgroundStyle = { backgroundImage: `url(${background.imageUrl})` };
  } else if (background.type === 'preset') {
    const preset = PRESET_BACKGROUNDS.find(p => p.id === background.presetId);
    if (preset) backgroundStyle = { backgroundImage: preset.gradient };
  } else if (currentTrack) {
    backgroundStyle = { backgroundImage: `url(${currentTrack.cover})` };
  }

  return (
    <div className="relative mx-auto flex h-screen max-w-md flex-col justify-between overflow-hidden bg-slate-950 text-white shadow-2xl">
      {/* Размытый неоновый задний фон */}
      {backgroundStyle && (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center opacity-30 blur-3xl scale-125 transition-all duration-1000"
          style={backgroundStyle}
        />
      )}

      {/* ШАПКА */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-14 pb-4">
        <button 
          onClick={() => {
            setActiveTab('playlist');
            setSelectedPlaylistId(null);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md active:scale-90 transition-transform"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <span className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
          {activeTab === 'player'
            ? "Сейчас играет"
            : activeTab === 'settings'
              ? "Настройки"
              : selectedPlaylistId ? "Плейлист" : "Медиатека"}
        </span>
        <div className="w-10"></div>
      </header>

      {/* КОНТЕНТ */}
      <main className="relative z-10 flex flex-1 flex-col justify-center px-6 overflow-hidden">
        
        {/* ================= ТАБ 1: ПЛЕЕР ================= */}
        {activeTab === 'player' && (
          currentTrack ? (
            <div className="flex flex-col items-center">
              {/* Обложка */}
              <div className="relative my-6">
                <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-xl scale-110"></div>
                <div className={`relative h-64 w-64 overflow-hidden rounded-full border-4 border-slate-800 shadow-2xl transition-all duration-500 ${isPlaying ? 'animate-[spin_20s_linear_infinite]' : ''}`}>
                  <img src={currentTrack.cover} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 m-auto h-12 w-12 rounded-full border-4 border-slate-900 bg-slate-950 flex items-center justify-center">
                    <div className="h-3 w-3 rounded-full bg-slate-800"></div>
                  </div>
                </div>
              </div>

              {/* Название и автор */}
              <div className="w-full text-center mt-4 mb-6">
                <h2 className="truncate text-xl font-bold px-2">{currentTrack.title}</h2>
                <p className="truncate text-sm font-medium text-indigo-300 mt-1">{currentTrack.artist}</p>
              </div>

              {/* Плавный ползунок перемотки */}
              <div className="w-full px-2">
                <input 
                  type="range" min="0" max={duration || 100} value={sliderValue}
                  onInput={(e) => {
                    setIsDragging(true);
                    setSliderValue(parseFloat(e.target.value));
                  }}
                  onChange={(e) => {
                    const newTime = parseFloat(e.target.value);
                    if (audioRef.current) {
                      audioRef.current.currentTime = newTime;
                    }
                    setCurrentTime(newTime);
                    setIsDragging(false);
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/20 accent-indigo-500 outline-none"
                  style={{ background: `linear-gradient(to right, #6366f1 ${ (sliderValue/(duration||100))*100 }%, rgba(255,255,255,0.2) ${ (sliderValue/(duration||100))*100 }%, rgba(255,255,255,0.2) 100%)` }}
                />
                <div className="flex justify-between text-xs text-slate-400 mt-2 font-mono">
                  <span>{Math.floor(sliderValue/60)}:{String(Math.floor(sliderValue%60)).padStart(2,'0')}</span>
                  <span>{Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,'0')}</span>
                </div>
              </div>

              {/* Обновленный пульт управления */}
              <div className="flex w-full items-center justify-center space-x-10 mt-8">
                {/* Назад */}
                <button onClick={handlePrev} className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 active:scale-90 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-6 h-6">
                    <path d="M9.189 11.238l9 5.143A1 1 0 0019.7 15.51V8.49a1 1 0 00-1.511-.865l-9 5.143a1 1 0 000 1.73l-.001.001zM1.7 15.51V8.49a1 1 0 011.511-.865l6.3 3.6a1 1 0 010 1.73l-6.3 3.6A1 1 0 011.7 15.51z" />
                  </svg>
                </button>

                {/* Воспроизведение / Пауза */}
                <button onClick={togglePlay} className="flex h-24 w-24 items-center justify-center rounded-full bg-white text-slate-950 active:scale-95 transition-transform shadow-2xl">
                  {isPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-9 h-9">
                      <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-9 h-9 translate-x-1">
                      <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>

                {/* Вперед */}
                <button onClick={handleNext} className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 active:scale-90 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-6 h-6">
                    <path d="M14.811 11.238l-9-5.143A1 1 0 004.3 6.96v7.02a1 1 0 001.511.865l9-5.143a1 1 0 000-1.73l-.001.001zM22.3 6.96v7.02a1 1 0 01-1.511.865l-6.3-3.6a1 1 0 010-1.73l6.3-3.6A1 1 0 0122.3 6.96z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-400 py-12">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 mb-4 opacity-50"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l6-6m0 0l6 6m-6-6v12a3 3 0 11-6 0V15" /></svg>
              <p className="text-center font-medium">Создайте плейлист и добавьте песни, чтобы начать воспроизведение</p>
            </div>
          )
        )}

        {/* ================= ТАБ 2: МЕДИАТЕКА ПЛЕЙЛИСТОВ ================= */}
        {activeTab === 'playlist' && (
          selectedPlaylistId === null ? (
            /* 2А: Список всех плейлистов */
            <div className="flex h-full flex-col justify-start pt-2 pb-4 overflow-hidden">
              <div className="mb-4 px-2">
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="flex w-full items-center justify-center space-x-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-4 font-semibold text-white shadow-lg active:scale-[0.99] transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  <span>Создать новый плейлист</span>
                </button>
              </div>

              {/* Сетка плейлистов в стиле iOS */}
              <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-4 p-2 max-h-[380px]">
                {playlists.map((playlist) => {
                  const count = trackCounts[playlist.id] || 0;
                  return (
                    <div
                      key={playlist.id}
                      onClick={() => setSelectedPlaylistId(playlist.id)}
                      className="flex flex-col rounded-2xl bg-white/5 border border-white/10 p-3 shadow-lg cursor-pointer active:scale-95 transition-all hover:bg-white/10 hover:border-indigo-500/30"
                    >
                      <img src={playlist.cover} className="aspect-square w-full rounded-xl object-cover mb-3 shadow-md" alt="" />
                      <span className="font-bold text-sm truncate text-left">{playlist.name}</span>
                      <span className="text-xs text-slate-400 mt-0.5 text-left">{count} {trackWord(count)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* 2Б: Детали конкретного открытого плейлиста */
            <div className="flex h-full flex-col justify-start pt-2 pb-4 overflow-hidden">
              {/* Кнопка "Назад к списку" */}
              <div className="flex items-center space-x-4 mb-4 px-2">
                <button 
                  onClick={() => setSelectedPlaylistId(null)}
                  className="flex items-center space-x-1 text-indigo-400 font-semibold"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                  <span>Назад</span>
                </button>
                <span className="font-bold text-lg truncate flex-1 text-left">
                  {playlists.find(p => p.id === selectedPlaylistId)?.name}
                </span>
              </div>

              {/* Кнопки управления плейлистом */}
              <div className="grid grid-cols-3 gap-2 mb-3 px-2">
                <button
                  onClick={() => fileInputRef.current.click()}
                  className="flex flex-col items-center justify-center space-y-1 rounded-xl bg-indigo-600 p-3 text-[11px] font-semibold active:scale-95 transition-transform"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  <span>Треки</span>
                </button>
                <button
                  onClick={() => openRenameModal(playlists.find(p => p.id === selectedPlaylistId))}
                  className="flex flex-col items-center justify-center space-y-1 rounded-xl bg-white/10 p-3 text-[11px] font-semibold active:scale-95 transition-transform"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
                  <span>Переим.</span>
                </button>
                <button
                  onClick={() => handleDeletePlaylist(selectedPlaylistId)}
                  className="flex flex-col items-center justify-center space-y-1 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 p-3 text-[11px] font-semibold active:scale-95 transition-transform"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.34 9m-4.72 0L9 9m5 12.42V18h-4.5v3.42M12 3a9 9 0 00-9 9h18a9 9 0 00-9-9z" /></svg>
                  <span>Удалить</span>
                </button>
                {/* Ограничиваем выбор строго списком расширений аудиофайлов, убрав "audio/*".
                    Это заставит iOS Safari открывать исключительно приложение "Файлы" */}
                <input
                  type="file" ref={fileInputRef} onChange={handleFileUpload}
                  multiple accept=".mp3,.m4a,.wav,.flac,.aac,.ogg" className="hidden"
                />
              </div>

              {uploadNotice && (
                <div className="mx-2 mb-3 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                  {uploadNotice}
                </div>
              )}

              {/* Список песен в плейлисте */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[320px] pb-4">
                {currentPlaylistTracks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                    <p className="text-sm">В этом плейлисте пока нет песен.</p>
                  </div>
                ) : (
                  currentPlaylistTracks.map((track, index) => {
                    const isCurrentPlaying = currentTrack && currentTrack.id === track.id && isPlaying;
                    return (
                      <div 
                        key={track.id}
                        onClick={() => playTrackFromPlaylist(selectedPlaylistId, index)}
                        className={`flex items-center justify-between p-3 rounded-2xl cursor-pointer ${isCurrentPlaying ? 'bg-indigo-600/30 border border-indigo-500/30' : 'bg-white/5'}`}
                      >
                        <div className="flex items-center space-x-4 min-w-0">
                          <img src={track.cover} className="h-12 w-12 rounded-xl object-cover flex-shrink-0" alt="" />
                          <div className="min-w-0 text-left">
                            <p className={`truncate font-semibold text-sm ${isCurrentPlaying ? 'text-indigo-300' : 'text-white'}`}>{track.title}</p>
                            <p className="truncate text-xs text-slate-400 mt-0.5">{track.artist}</p>
                          </div>
                        </div>
                        
                        <button 
                          onClick={(e) => handleDeleteTrack(track.id, e)}
                          className="p-2 text-slate-500 hover:text-rose-400 active:scale-90"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )
        )}

        {/* ================= ТАБ 3: НАСТРОЙКИ ================= */}
        {activeTab === 'settings' && (
          <div className="flex h-full flex-col justify-start pt-2 pb-4 overflow-y-auto max-h-[460px] space-y-6 px-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 px-1">Фон плеера</h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <button
                  onClick={selectDefaultBackground}
                  className={`aspect-square rounded-2xl border-2 flex items-center justify-center bg-slate-800 p-2 text-center active:scale-95 transition-all ${background.type === 'default' ? 'border-indigo-500' : 'border-transparent'}`}
                >
                  <span className="text-[10px] font-semibold text-slate-300">По умолчанию</span>
                </button>
                {PRESET_BACKGROUNDS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => selectPresetBackground(preset.id)}
                    className={`aspect-square rounded-2xl border-2 flex items-end p-2 active:scale-95 transition-all ${background.type === 'preset' && background.presetId === preset.id ? 'border-indigo-500' : 'border-transparent'}`}
                    style={{ backgroundImage: preset.gradient }}
                  >
                    <span className="text-[10px] font-semibold text-white drop-shadow">{preset.name}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => backgroundFileInputRef.current.click()}
                className={`flex w-full items-center justify-center space-x-2 rounded-2xl p-4 font-semibold text-sm shadow-lg active:scale-[0.99] transition-all border-2 ${background.type === 'custom' ? 'border-indigo-500 bg-indigo-600/20' : 'border-transparent bg-white/5'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 4.5h18M3.75 3.75h16.5a.75.75 0 01.75.75v15a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V4.5a.75.75 0 01.75-.75z" />
                </svg>
                <span>Выбрать своё фото</span>
              </button>
              <input
                type="file" ref={backgroundFileInputRef} onChange={handleBackgroundImageUpload}
                accept="image/*" className="hidden"
              />
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 px-1">Хранилище данных</h3>
              <div className="rounded-2xl bg-white/5 p-4 text-xs leading-relaxed text-slate-300">
                {storagePersisted === null && 'Проверяем состояние хранилища...'}
                {storagePersisted === true && 'Хранилище защищено: Safari не будет автоматически удалять ваши плейлисты и треки при долгом простое.'}
                {storagePersisted === false && 'Не удалось защитить хранилище от автоматической очистки. Открывайте приложение почаще, чтобы Safari не считала его неактивным.'}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* КРАСИВЫЙ СИСТЕМНЫЙ МОДАЛ СОЗДАНИЯ ПЛЕЙЛИСТА */}
      {showCreateModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md px-6">
          <div className="w-full rounded-3xl bg-slate-900 border border-white/10 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-250">
            <h3 className="text-lg font-bold mb-4">Новый плейлист</h3>
            <input 
              type="text" 
              placeholder="Название плейлиста" 
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/10 p-3 text-white outline-none focus:border-indigo-500"
              maxLength={30}
              autoFocus
            />
            <div className="flex space-x-3 mt-6">
              <button 
                onClick={() => {
                  setShowCreateModal(false);
                  setNewPlaylistName('');
                }}
                className="flex-1 rounded-xl bg-white/5 p-3 text-sm font-semibold hover:bg-white/10"
              >
                Отмена
              </button>
              <button
                onClick={handleCreatePlaylist}
                className="flex-1 rounded-xl bg-indigo-600 p-3 text-sm font-semibold hover:bg-indigo-500"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛ ПЕРЕИМЕНОВАНИЯ ПЛЕЙЛИСТА */}
      {showRenameModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md px-6">
          <div className="w-full rounded-3xl bg-slate-900 border border-white/10 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-250">
            <h3 className="text-lg font-bold mb-4">Переименовать плейлист</h3>
            <input
              type="text"
              placeholder="Название плейлиста"
              value={renamePlaylistName}
              onChange={(e) => setRenamePlaylistName(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/10 p-3 text-white outline-none focus:border-indigo-500"
              maxLength={30}
              autoFocus
            />
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowRenameModal(false);
                  setRenamePlaylistId(null);
                  setRenamePlaylistName('');
                }}
                className="flex-1 rounded-xl bg-white/5 p-3 text-sm font-semibold hover:bg-white/10"
              >
                Отмена
              </button>
              <button
                onClick={handleRenamePlaylist}
                className="flex-1 rounded-xl bg-indigo-600 p-3 text-sm font-semibold hover:bg-indigo-500"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ТАББАР (с Safe Area снизу) */}
      <footer className="relative z-10 flex items-center justify-around border-t border-white/10 bg-slate-950/80 backdrop-blur-lg px-8 pt-4 pb-8">
        <button onClick={() => setActiveTab('player')} className={`flex flex-col items-center space-y-1 text-xs font-medium ${activeTab === 'player' ? 'text-indigo-400' : 'text-slate-500'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l6-6m0 0l6 6m-6-6v12a3 3 0 11-6 0V15" /></svg>
          <span>Плеер</span>
        </button>
        <button onClick={() => { setActiveTab('playlist'); setSelectedPlaylistId(null); }} className={`flex flex-col items-center space-y-1 text-xs font-medium ${activeTab === 'playlist' ? 'text-indigo-400' : 'text-slate-500'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          <span>Библиотека</span>
        </button>
        <button onClick={() => setActiveTab('settings')} className={`flex flex-col items-center space-y-1 text-xs font-medium ${activeTab === 'settings' ? 'text-indigo-400' : 'text-slate-500'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.241.437-.613.43-.991a7.712 7.712 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <span>Настройки</span>
        </button>
      </footer>
    </div>
  );
}