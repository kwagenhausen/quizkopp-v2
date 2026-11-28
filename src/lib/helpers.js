import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { isFsImage } from './images';

// Luftlinien-Berechnung (Haversine)
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
};

// --- HELFER: FOLIEN & NUMMERIERUNG ---
export const isInfoItem = (q) => q?.type === 'break' || q?.type === 'slide' || q?.type === 'round';

export const isSlideLike = (q) => q?.type === 'slide' || q?.type === 'round';

export const getRoundNumber = (questions, idx) => questions.slice(0, idx + 1).filter(q => q.type === 'round').length;

export const getQuestionNumber = (questions, idx) => questions.slice(0, idx + 1).filter(q => !isInfoItem(q)).length;

export const getQuestionTotal = (questions) => questions.filter(q => !isInfoItem(q)).length;

export const toggleFullscreen = () => {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  } catch (e) { console.log('Vollbild nicht möglich:', e); }
};

// --- ZAHLEN, DIE HOCHZÄHLEN ---
export const fmtPts = (n) => (Math.round(n * 2) / 2).toLocaleString('de-DE');

// --- SIEGERTREPPCHEN: Platz 3, 2, 1 nacheinander enthüllen ---
export const getPodiumSize = (teams) => Math.min(3, teams.length);

export const isPlaceRevealed = (place, teamCount, step) => {
  const k = Math.min(3, teamCount);
  return place > k || place > k - step;
};

export const vibrate = (pattern) => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} };

export const getMediaType = (url) => {
  if (!url) return 'none';
  if (isFsImage(url) || url.startsWith('data:image')) return 'image';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.wav') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.ogg')) return 'audio';
  return 'image';
};

export const getYouTubeEmbedUrl = (url) => {
  try {
    let videoId = '';
    if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1].split(/[?#]/)[0];
    } else if (url.includes('youtube.com/watch')) {
        videoId = url.split('v=')[1].split('&')[0];
    } else if (url.includes('youtube.com/embed/')) {
        return url; 
    }
    return `https://www.youtube.com/embed/${videoId}?rel=0`;
  } catch (e) {
    return url;
  }
};

export const getSortedTeams = (players, room) => {
  if (!room || !players) return [];
  const teamsMap = {};
  
  players.forEach(p => {
      const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
      if (!teamsMap[tId]) {
          teamsMap[tId] = { name: tId, players: [], playerScoreSum: 0, estimationScore: room.teamScores?.[tId] || 0 };
      }
      teamsMap[tId].players.push(p);
      teamsMap[tId].playerScoreSum += p.score;
  });

  Object.values(teamsMap).forEach(t => { t.totalScore = t.playerScoreSum + t.estimationScore; t.style = getTeamStyle(t.name, players); });
  return Object.values(teamsMap).sort((a,b) => b.totalScore - a.totalScore);
};

export const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';
  for (let i = 0; i < 4; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
};

export const downloadCSV = (players, room) => {
  const sortedTeams = getSortedTeams(players, room);
  const headers = ["Team-Platz", "Team", "Team-Punkte Gesamt", "Spieler", "Spieler-Punkte (ohne Schätzen)"];
  
  room.questions.forEach((q, i) => {
      headers.push(q.type === 'break' ? `Pause: ${q.q.replace(/,/g, "")}` : q.type === 'slide' ? `Folie: ${(q.q || '').replace(/,/g, "")}` : q.type === 'round' ? `Runde: ${(q.q || '').replace(/,/g, "")}` : `F${i+1}: ${q.q.replace(/,/g, "")}`);
  });
  
  const rows = players.map(p => {
    const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
    const myTeam = sortedTeams.find(t => t.name === tId);
    const teamRank = sortedTeams.findIndex(t => t.name === tId) + 1;

    const row = [teamRank, tId, myTeam.totalScore, p.name, p.score];
    room.questions.forEach((q, qi) => {
      const a = p.answers?.[qi];
      if (isInfoItem(q)) row.push("---");
      else if (q.type === 'multiple' && a !== undefined && a !== "") row.push(q.options[a]?.replace(/,/g, "") || "---");
      else if (q.type === 'buzzer') row.push(a ? "Gebuzzert & Richtig" : "---");
      else if (q.type === 'geo' && a?.lat) row.push(`${a.lat.toFixed(4)} / ${a.lng.toFixed(4)}`);
      else if (q.type === 'order' && Array.isArray(a)) row.push(`${countOrderCorrect(q, a)}/${getOrderItems(q).length} richtig`);
      else row.push(a?.toString().replace(/,/g, "") || "---");
    });
    return row;
  });

  rows.sort((a, b) => a[0] - b[0]);

  const csv = "\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `Quizkopp_Export_${room.id}.csv`; a.click();
};

export const getBaseQuestionTemplate = () => ({
    type:'multiple',
    q:'',
    options:['','','',''],
    correctIndex:0,
    correctValue:'',
    timer:0,
    imgUrl:'',
    showImg:true, 
    showAnswers: true, 
    isJoker: false, 
    note: '',
    steps: [{text: '', points: 5}, {text: '', points: 3}, {text: '', points: 1}],
    targetLat: 51.165691, 
    targetLng: 10.451526,
    mapStyle: 'comic',
    startView: 'europe',
    orderItems: ['', '', '', ''],
    orderScoring: 'all',
    orderHint: '',
    zoomX: 50,
    zoomY: 50,
    zoomStart: 6,
    hostNotes: ''
});

export const getSlideTemplate = () => ({
    ...getBaseQuestionTemplate(),
    type: 'slide',
    showImg: false,
    showAnswers: false,
    timer: 0,
    isJoker: false
});

// --- AUFRÄUMEN: alte Räume & Spieler löschen (läuft im Hintergrund, wenn ein Quiz gestartet wird) ---
export const ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
 // Räume älter als 12 Stunden gelten als beendet

export const deleteDocsInChunks = async (refs) => {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach(r => batch.delete(r));
    await batch.commit();
  }
};

export const deleteRoomWithPlayers = async (roomCode) => {
  const ps = await getDocs(query(collection(db, 'players'), where('roomCode', '==', roomCode)));
  await deleteDocsInChunks([...ps.docs.map(d => d.ref), doc(db, 'rooms', roomCode)]);
};

export const cleanupOldData = async (keepRoomCode) => {
  try {
    const now = Date.now();
    const roomsSnap = await getDocs(collection(db, 'rooms'));
    const liveRooms = new Set();
    const oldRoomRefs = [];
    roomsSnap.docs.forEach(d => {
      const created = d.data().createdAt || 0;
      if (d.id === keepRoomCode || now - created < ROOM_MAX_AGE_MS) liveRooms.add(d.id);
      else oldRoomRefs.push(d.ref);
    });
    const playersSnap = await getDocs(collection(db, 'players'));
    const orphanPlayerRefs = playersSnap.docs.filter(d => !liveRooms.has(d.data().roomCode)).map(d => d.ref);
    await deleteDocsInChunks([...oldRoomRefs, ...orphanPlayerRefs]);
    if (oldRoomRefs.length || orphanPlayerRefs.length) {
      console.log(`Aufgeräumt: ${oldRoomRefs.length} alte Räume, ${orphanPlayerRefs.length} alte Spieler.`);
    }
  } catch (err) {
    console.error('Aufräumen fehlgeschlagen:', err);
  }
};

// --- Fragetypen, die du von Hand bewertest ---
export const isManualGraded = (q) => ['text', 'step', 'geo', 'zoom'].includes(q?.type);

// --- REIHENFOLGE ---
export const getOrderItems = (q) => (q?.orderItems || []).map(s => (s || '').trim()).filter(Boolean);

const hashString = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seededRandom = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// Gemischte Reihenfolge – für alle Geräte gleich, nie schon richtig sortiert
export const getOrderShuffle = (q) => {
  const items = getOrderItems(q);
  const n = items.length;
  const idx = [...Array(n).keys()];
  const rnd = seededRandom(hashString((q?.q || '') + '|' + items.join('|')));
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  if (n > 1 && idx.every((v, i) => v === i)) idx.push(idx.shift());
  return idx;
};

export const countOrderCorrect = (q, answer) => Array.isArray(answer) ? answer.filter((v, i) => v === i).length : 0;
export const getOrderPoints = (q, answer) => {
  const n = getOrderItems(q).length;
  const c = countOrderCorrect(q, answer);
  return q?.orderScoring === 'each' ? c : (n > 0 && c === n ? 1 : 0);
};

// --- BILD-ZOOM ---
export const ZOOM_DEFAULT_SECONDS = 30;
export const getZoomScale = (q, progress, revealed) => {
  if (revealed) return 1;
  const start = Number(q?.zoomStart) || 6;
  const end = 1.3; // am Ende noch leicht gezoomt – das ganze Bild gibt es erst bei der Auflösung
  return start - (start - end) * Math.min(1, Math.max(0, progress || 0));
};

// --- LÖSUNG ALS TEXT (für die Moderatoren-Ansicht) ---
export const getSolutionText = (q) => {
  if (!q) return '';
  switch (q.type) {
    case 'multiple': return `${'ABCD'[q.correctIndex] || '?'}: ${(q.options || [])[q.correctIndex] || '–'}`;
    case 'order': return getOrderItems(q).map((s, i) => `${i + 1}. ${s}`).join('\n');
    case 'geo': return `Ziel-Pin bei ${Number(q.targetLat).toFixed(3)}, ${Number(q.targetLng).toFixed(3)}`;
    default: return q.correctValue || '– keine Lösung hinterlegt –';
  }
};

// --- TEAMFARBEN & AVATARE ---
export const TEAM_STYLES = [
  { emoji: '🦀', name: 'Krabben',  color: '#F97316' },
  { emoji: '⛵', name: 'Segler',   color: '#22C55E' },
  { emoji: '🐙', name: 'Kraken',   color: '#A855F7' },
  { emoji: '🐳', name: 'Wale',     color: '#3B82F6' },
  { emoji: '🧭', name: 'Lotsen',   color: '#EAB308' },
  { emoji: '🦞', name: 'Hummer',   color: '#EF4444' },
  { emoji: '🐚', name: 'Muscheln', color: '#EC4899' },
  { emoji: '🐬', name: 'Delfine',  color: '#14B8A6' },
  { emoji: '⚓', name: 'Anker',    color: '#64748B' },
  { emoji: '🚢', name: 'Dampfer',  color: '#A16207' },
  { emoji: '🦭', name: 'Robben',   color: '#06B6D4' },
  { emoji: '🦈', name: 'Haie',     color: '#84CC16' },
];

export const getTeamId = (p) => (p?.team && p.team.trim() !== '' ? p.team.trim() : p?.name || '');

// Das Symbol eines Teams: das, was beim Beitreten gewählt wurde – sonst fest aus dem Namen abgeleitet
export const getTeamStyleIndex = (teamId, players) => {
  const withStyle = (players || [])
    .filter(p => getTeamId(p) === teamId && Number.isInteger(p.teamStyle))
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const n = TEAM_STYLES.length;
  const i = withStyle ? withStyle.teamStyle : hashString(teamId || '?');
  return ((i % n) + n) % n;
};
export const getTeamStyle = (teamId, players) => TEAM_STYLES[getTeamStyleIndex(teamId, players)];
export const getPlayerStyle = (player, players) => getTeamStyle(getTeamId(player), players);
