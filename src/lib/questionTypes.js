import { getBaseQuestionTemplate, getMediaType, getOrderItems, getSlideTemplate, isInfoItem, isSlideLike } from './helpers';
import { isFsImage } from './images';

// --- EDITOR: TYPEN, VORLAGEN & PRÜFUNG ---
export const QUESTION_TYPES = [
  { type: 'multiple',   icon: '🔤', label: 'Multiple Choice', desc: '4 Antworten, eine davon ist richtig' },
  { type: 'text',       icon: '✍️', label: 'Freitext',        desc: 'Spieler tippen ihre Antwort, du bewertest' },
  { type: 'estimation', icon: '⚖️', label: 'Schätzfrage',     desc: 'Das Team, das am nächsten dran ist, gewinnt' },
  { type: 'buzzer',     icon: '🔔', label: 'Buzzer',          desc: 'Wer zuerst drückt, darf antworten' },
  { type: 'step',       icon: '🪜', label: 'Stufen-Rätsel',   desc: 'Hinweise nacheinander – früh raten bringt mehr Punkte' },
  { type: 'geo',        icon: '🗺️', label: 'Geo-Quiz',        desc: 'Pin auf der Karte setzen, Entfernung zählt' },
  { type: 'order',      icon: '🔢', label: 'Reihenfolge',     desc: 'Einträge in die richtige Reihenfolge bringen' },
  { type: 'zoom',       icon: '🔍', label: 'Bild-Zoom',       desc: 'Ein Ausschnitt zoomt langsam heraus – wer erkennt es zuerst?' },
  { type: 'round',      icon: '🎬', label: 'Neue Runde',      desc: 'Startfolie einer Runde – gliedert deinen Ablauf' },
  { type: 'slide',      icon: '🖼️', label: 'Folie',           desc: 'Bild oder Text, z.B. Regeln oder Erklärung' },
  { type: 'break',      icon: '⏸️', label: 'Zwischenstand',   desc: 'Zeigt allen das aktuelle Ranking' },
];

export const getTypeInfo = (type) => QUESTION_TYPES.find(t => t.type === type) || QUESTION_TYPES[0];

export const makeKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const withKey = (q) => (q && q._key ? q : { ...q, _key: makeKey() });

export const DEFAULT_GEO = { lat: 51.165691, lng: 10.451526 };

export const createItem = (type) => {
  const base = isSlideLike({ type }) ? getSlideTemplate() : getBaseQuestionTemplate();
  return applyTypeDefaults({ ...base, type, _key: makeKey() }, type);
};

// Sorgt dafür, dass beim Typwechsel alle nötigen Felder da sind
export const applyTypeDefaults = (q, type) => {
  const n = { ...q, type };
  if (type === 'step' && !(n.steps && n.steps.length)) n.steps = [{ text: '', points: 5 }, { text: '', points: 3 }, { text: '', points: 1 }];
  if (type === 'geo') {
    n.targetLat = n.targetLat ?? DEFAULT_GEO.lat;
    n.targetLng = n.targetLng ?? DEFAULT_GEO.lng;
    n.mapStyle = n.mapStyle || 'comic';
    n.startView = n.startView || 'europe';
  }
  if (isInfoItem({ type })) { n.timer = 0; n.isJoker = false; }
  if (isSlideLike({ type })) n.showImg = false;
  if (type === 'multiple' && !(n.options && n.options.length === 4)) n.options = ['', '', '', ''];
  if (type === 'order' && !(n.orderItems && n.orderItems.length >= 3)) n.orderItems = ['', '', '', ''];
  if (type === 'zoom') {
    n.zoomX = n.zoomX ?? 50; n.zoomY = n.zoomY ?? 50; n.zoomStart = n.zoomStart || 6;
    if (!(n.timer > 0)) n.timer = 30; // der Zoom läuft im Takt des Timers
  }
  return n;
};

export const getItemTitle = (q) => {
  if (q.q && q.q.trim()) return q.q.trim();
  if (q.type === 'buzzer') return 'Buzzer-Runde';
  if (q.type === 'break') return 'Zwischenstand';
  if (q.type === 'slide') return q.imgUrl ? 'Folie' : 'Leere Folie';
  if (q.type === 'round') return 'Neue Runde';
  return 'Neue Frage';
};

export const getWarnings = (q) => {
  const w = [];
  const needsText = ['multiple', 'text', 'estimation', 'step', 'geo', 'order', 'zoom'].includes(q.type);
  if (needsText && !(q.q || '').trim()) w.push(q.type === 'step' ? 'Kategorie / Hauptfrage fehlt' : 'Fragetext fehlt');
  if (q.type === 'multiple') {
    const filled = (q.options || []).filter(o => (o || '').trim());
    if (filled.length < 2) w.push('Mindestens 2 Antworten eintragen');
    else if (!((q.options || [])[q.correctIndex] || '').trim()) w.push('Die markierte richtige Antwort ist leer');
  }
  if (q.type === 'step' && !(q.steps || []).some(s => (s.text || '').trim())) w.push('Noch keine Hinweise eingetragen');
  if (q.type === 'geo' && Number(q.targetLat) === DEFAULT_GEO.lat && Number(q.targetLng) === DEFAULT_GEO.lng) w.push('Ziel noch nicht gesetzt (steht auf der Standardposition)');
  if (q.type === 'slide' && !q.imgUrl && !(q.q || '').trim()) w.push('Die Folie ist noch leer');
  if (q.type === 'round' && !(q.q || '').trim()) w.push('Name der Runde fehlt');
  if (q.type === 'order' && getOrderItems(q).length < 3) w.push('Mindestens 3 Einträge eintragen');
  if (q.type === 'zoom' && !q.imgUrl) w.push('Bild fehlt');
  if (getMediaType(q.imgUrl) === 'image' && q.imgUrl && !isFsImage(q.imgUrl) && !/^(https?:|\/|data:)/i.test(q.imgUrl)) w.push('Der Medien-Link sieht ungültig aus');
  return w;
};
