import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List, Save, FolderOpen, Folder, Download, Trash2, Lock, Image as ImageIcon, Clock, Bell, Edit3, Upload, Smartphone, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Maximize, X, Copy } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, deleteDoc, updateDoc, getDocs, writeBatch, query, where } from 'firebase/firestore';

// --- KARTEN IMPORTE (REINES NATIVES LEAFLET!) ---
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// --- ABSOLUT SICHERE CSS-ICONS ---
const getPinIcon = (isTarget = false, opts = {}) => {
    if (typeof window === 'undefined') return null;
    const size = isTarget || opts.winner ? 30 : 24;
    const color = isTarget ? '#DC2626' : (opts.winner ? '#FACC15' : '#E69F00');
    return L.divIcon({
        className: 'custom-css-pin',
        html: `<div class="${opts.drop ? 'geo-pin-drop' : ''}" style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.4); position: relative; top: -${size / 2}px; left: -${size / 2}px;"></div>`,
        iconSize: [0, 0]
    });
};

const GEO_CSS = `
.geo-pin-drop { animation: geoPinDrop .8s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes geoPinDrop { 0% { transform: translateY(-80px) scale(.6); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
.geo-line { animation: geoLineIn .5s ease-out both; }
@keyframes geoLineIn { from { opacity: 0; } to { opacity: 1; } }
.leaflet-tooltip.geo-label { background: rgba(15,23,42,.88); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 12px; padding: 3px 8px; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
.leaflet-tooltip-top.geo-label:before { border-top-color: rgba(15,23,42,.88); }
.leaflet-tooltip.geo-label-target { background: #DC2626; font-size: 15px; }
.leaflet-tooltip-top.geo-label-target:before { border-top-color: #DC2626; }
.leaflet-tooltip.geo-label-winner { background: #CA8A04; font-size: 15px; }
.leaflet-tooltip-top.geo-label-winner:before { border-top-color: #CA8A04; }
`;

const formatKm = (d) => (d == null || isNaN(d)) ? '' : `${d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString('de-DE')} km`;

// --- KARTENSTILE & STARTAUSSCHNITTE FÜR DAS GEO-QUIZ ---
// Beide Stile sind kostenlos, ohne API-Schlüssel und zeigen keine Ländergrenzen, Städte oder Beschriftungen.
const MAP_STYLES = {
    comic: { label: '🎮 Comic (wie Schlag den Star)' },
    satellite: { label: '🛰️ Satellit mit Vegetation (NASA)' },
};

const MAP_VIEWS = {
    world:     { label: '🌍 Welt',          bounds: [[-50, -160], [72, 175]] },
    europe:    { label: '🇪🇺 Europa',        bounds: [[35, -11], [70, 40]] },
    germany:   { label: '🇩🇪 Deutschland',   bounds: [[47.2, 5.8], [55.1, 15.1]] },
    dach:      { label: '⛰️ D-A-CH',        bounds: [[45.8, 5.8], [55.1, 17.2]] },
    northamerica: { label: '🌎 Nordamerika', bounds: [[15, -130], [62, -60]] },
    southamerica: { label: '🌎 Südamerika',  bounds: [[-56, -82], [13, -34]] },
    africa:    { label: '🌍 Afrika',         bounds: [[-35, -18], [37, 52]] },
    asia:      { label: '🌏 Asien',          bounds: [[-10, 25], [60, 150]] },
    oceania:   { label: '🌏 Australien & Ozeanien', bounds: [[-48, 110], [0, 180]] },
};

// Landflächen (ohne Ländergrenzen) von Natural Earth – wird nur einmal geladen
const LAND_GEOJSON_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';
let landPromise = null;
const loadLandGeoJSON = () => {
    if (!landPromise) {
        landPromise = fetch(LAND_GEOJSON_URL)
            .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .catch(err => { landPromise = null; throw err; });
    }
    return landPromise;
};

// Wechselt die Hintergrundkarte: 'comic', 'satellite' oder 'real' (echte Karte mit Beschriftung).
// Mit fade=true wird die echte Karte weich über die bisherige geblendet.
const setBaseLayer = (map, mapDom, style, groupRef, fade = false) => {
    if (!map.getPane('basePane')) {
        map.createPane('basePane');
        map.getPane('basePane').style.zIndex = 150; // unter den Kacheln, damit die echte Karte darüber blenden kann
    }
    let closed = false;
    map.on('unload', () => { closed = true; });

    const oldGroup = groupRef.current;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    const removeOld = () => { if (oldGroup) { try { map.removeLayer(oldGroup); } catch (e) {} } };

    if (style === 'real') {
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 18, zIndex: 10, opacity: fade ? 0 : 1
        }).addTo(group);
        if (fade) {
            const container = osm.getContainer();
            if (container) container.style.transition = 'opacity 1.4s ease-in-out';
            let shown = false;
            const show = () => {
                if (shown || closed) return;
                shown = true;
                osm.setOpacity(1);
                setTimeout(() => { if (!closed) { mapDom.style.backgroundColor = '#aad3df'; removeOld(); } }, 1600);
            };
            osm.once('load', show);
            setTimeout(show, 1200); // falls "load" nicht kommt
        } else {
            mapDom.style.backgroundColor = '#aad3df';
            removeOld();
        }
        return;
    }

    removeOld();

    if (style === 'satellite') {
        mapDom.style.backgroundColor = '#0B2A4A';
        const nasa = L.tileLayer('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/EPSG3857_500m/{z}/{y}/{x}.jpeg', {
            maxNativeZoom: 8, maxZoom: 10, attribution: 'NASA Blue Marble'
        });
        // Falls der NASA-Server streikt: automatisch auf Esri-Satellitenbilder (ebenfalls ohne Beschriftung) wechseln
        let switched = false;
        nasa.on('tileerror', () => {
            if (switched || closed) return;
            switched = true;
            group.removeLayer(nasa);
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 10, attribution: 'Esri, Maxar, Earthstar Geographics'
            }).addTo(group);
        });
        nasa.addTo(group);
        return;
    }

    // Comic-Stil
    mapDom.style.backgroundColor = '#4FB6EC'; // helles Meerblau
    loadLandGeoJSON()
        .then(data => {
            if (closed || groupRef.current !== group) return;
            const base = { interactive: false, pane: 'basePane' };
            // Weißer Schimmer an den Küsten (breit & weich + schmal & hell)
            L.geoJSON(data, { ...base, style: { color: '#FFFFFF', weight: 16, opacity: 0.25, fill: false, lineJoin: 'round' } }).addTo(group);
            L.geoJSON(data, { ...base, style: { color: '#E6F7FF', weight: 6, opacity: 0.7, fill: false, lineJoin: 'round' } }).addTo(group);
            // Grünes Land
            L.geoJSON(data, { ...base, style: { color: '#3F9E22', weight: 1, opacity: 1, fillColor: '#5CC032', fillOpacity: 1 } }).addTo(group);
        })
        .catch(e => console.error('Konnte die Landflächen nicht laden:', e));
};

// --- DIE NATIVE, CRASH-SICHERE ALL-IN-ONE KARTE ---
// stage (nur bei readOnly/Auflösung): 'pins' = nur Spieler-Tipps, 'target' = Ziel + echte Karte,
// null = alte Ein-Schritt-Auflösung (Ziel sofort, Kartenstil bleibt).
const GeoMap = ({ lat, lng, onMapClick, isTarget = false, playerPins = [], readOnly = false, hideLabels = false, mapStyle = 'comic', startView = 'europe', stage = null }) => {
    const mapDomRef = useRef(null);
    const mapRef = useRef(null);
    const markerRef = useRef(null);
    const baseGroupRef = useRef(null);
    const currentBaseRef = useRef(null);
    const playerElementsRef = useRef({ markers: [], lines: [] });
    const timersRef = useRef([]);
    const prevStageRef = useRef(stage);

    const wantedBase = (readOnly && stage === 'target') ? 'real' : mapStyle;

    useEffect(() => {
        if (!mapDomRef.current || mapRef.current) return;
        
        // 1. Karte initialisieren
        const maxZoomLevel = (readOnly || hideLabels) ? 10 : 18; 
        
        const map = L.map(mapDomRef.current, {
            maxZoom: maxZoomLevel,
            minZoom: 2,
            maxBounds: [[-85, -200], [85, 200]], // Verhindert, dass man in den "leeren Raum" scrollt
            maxBoundsViscosity: 0.8
        });
        const view = MAP_VIEWS[startView] || MAP_VIEWS.europe;
        if (hideLabels && (!readOnly || stage === 'pins')) {
            // Spieler (und die Tipp-Übersicht) starten im gewählten Ausschnitt – verrät nichts über das Ziel
            map.fitBounds(view.bounds);
        } else {
            map.setView([lat || 51.165, lng || 10.451], readOnly ? 4 : 5);
        }
        
        mapRef.current = map;
        
        // 2. KARTEN-MATERIAL AUSWÄHLEN (ohne Beschriftung für Spieler & Beamer, Standard für Setup)
        if (hideLabels) {
            setBaseLayer(map, mapDomRef.current, wantedBase, baseGroupRef, false);
            currentBaseRef.current = wantedBase;
        } else {
            // Im Admin/Setup-Modus nutzen wir die detaillierte OpenStreetMap
            mapDomRef.current.style.backgroundColor = '#aad3df';
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
                attribution: '&copy; OpenStreetMap',
                maxZoom: maxZoomLevel
            }).addTo(map);
        }

        // 3. Klick-Event für Setup und Spieler binden
        if (onMapClick && !readOnly) {
            map.on('click', (e) => {
                // Nur nackte Koordinaten weitergeben, verhindert Abstürze!
                onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
            });
        }

        // Cleanup beim Schließen
        return () => {
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []); // Läuft nur 1x beim Start

    // 4. Hintergrund wechseln, wenn die Auflösung startet (Spielkarte -> echte Karte)
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !hideLabels || currentBaseRef.current === wantedBase) return;
        const t = setTimeout(() => {
            if (!mapRef.current) return;
            setBaseLayer(mapRef.current, mapDomRef.current, wantedBase, baseGroupRef, true);
            currentBaseRef.current = wantedBase;
        }, 900);
        return () => clearTimeout(t);
    }, [wantedBase]);

    // 5. Haupt-Marker (Ziel oder Spieler-Tipp) – bei der Tipp-Übersicht bleibt das Ziel noch geheim
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const showMain = lat != null && lng != null && !isNaN(lat) && !(readOnly && stage === 'pins');
        if (!showMain) {
            if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
            return;
        }
        if (!markerRef.current) {
            markerRef.current = L.marker([lat, lng], { icon: getPinIcon(isTarget, { drop: readOnly }), zIndexOffset: 1000 }).addTo(map);
            if (readOnly && isTarget) {
                markerRef.current.bindTooltip('🎯 Ziel', { permanent: true, direction: 'top', offset: [0, -18], className: 'geo-label geo-label-target' });
            }
        } else {
            markerRef.current.setLatLng([lat, lng]);
        }
    }, [lat, lng, isTarget, readOnly, stage]);

    // 6. Spieler-Pins, Linien und Entfernungen (nur bei der Auflösung)
    const pinsKey = JSON.stringify((playerPins || []).map(p => [p.id, p.name, p.lat, p.lng]));
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !readOnly) return;

        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        playerElementsRef.current.markers.forEach(m => m.remove());
        playerElementsRef.current.lines.forEach(l => l.remove());
        playerElementsRef.current = { markers: [], lines: [] };

        const later = (fn, ms) => { timersRef.current.push(setTimeout(() => { if (mapRef.current) fn(); }, ms)); };
        const pins = (playerPins || []).filter(p => p.lat != null && p.lng != null && !isNaN(p.lat));
        const showTarget = stage !== 'pins' && lat != null && lng != null && !isNaN(lat);
        const animate = stage === 'target' && prevStageRef.current === 'pins';
        prevStageRef.current = stage;

        // Pins mit Namensschild setzen
        const entries = pins.map(p => {
            const m = L.marker([p.lat, p.lng], { icon: getPinIcon(false, { drop: stage === 'pins' }) })
                .bindTooltip(p.name, { permanent: true, direction: 'top', offset: [0, -14], className: 'geo-label' })
                .addTo(map);
            playerElementsRef.current.markers.push(m);
            return { p, m };
        });

        // Kartenausschnitt: alle Tipps (und ggf. das Ziel) ins Bild holen
        const bounds = pins.map(p => [p.lat, p.lng]);
        if (showTarget) bounds.push([lat, lng]);
        if (bounds.length > 1) {
            if (animate) {
                try { map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 8, duration: 1.6 }); } catch (e) {}
            } else {
                later(() => { try { map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 }); } catch (e) {} }, 300);
            }
        } else if (bounds.length === 1) {
            later(() => { try { map.setView(bounds[0], 6); } catch (e) {} }, 300);
        }

        if (!showTarget || entries.length === 0) return;

        // Auflösung: Linien vom weitesten zum nächsten Tipp – der Gewinner kommt zum Schluss
        const sorted = [...entries].sort((a, b) => (b.p.dist ?? 0) - (a.p.dist ?? 0));
        const minDist = Math.min(...entries.map(e => e.p.dist ?? Infinity));
        const startAt = animate ? 1900 : 0;
        const step = animate ? Math.max(180, Math.min(450, 2400 / sorted.length)) : 0;

        sorted.forEach(({ p, m }, i) => {
            later(() => {
                const l = L.polyline([[lat, lng], [p.lat, p.lng]], { color: '#E69F00', weight: 3, dashArray: '6, 10', className: 'geo-line' }).addTo(map);
                playerElementsRef.current.lines.push(l);
                m.setTooltipContent(`${p.name} · ${formatKm(p.dist)}`);
            }, startAt + i * step);
        });

        later(() => {
            entries.filter(e => e.p.dist === minDist).forEach(({ p, m }) => {
                m.setIcon(getPinIcon(false, { winner: true, drop: animate }));
                m.setZIndexOffset(900);
                m.setTooltipContent(`🏆 ${p.name} · ${formatKm(p.dist)}`);
                m.getTooltip()?.getElement()?.classList.add('geo-label-winner');
            });
        }, startAt + sorted.length * step + (animate ? 500 : 0));
    }, [pinsKey, lat, lng, readOnly, stage]);

    return (
        <>
            <style>{GEO_CSS}</style>
            <div ref={mapDomRef} className="w-full h-full z-0 relative" />
        </>
    );
};

// Karten-Schutzschild
class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error.message || error.toString() };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-50 border border-red-200 text-red-600 rounded-2xl w-full flex flex-col items-center justify-center text-center">
          <span className="font-bold text-lg mb-2">Karte blockiert</span>
          <p className="text-sm mb-4">Fehler: {this.state.errorMsg}</p>
          <button onClick={() => window.location.reload()} className="bg-red-100 hover:bg-red-200 px-6 py-3 rounded-xl text-red-800 font-bold transition-colors shadow-sm">App neu laden</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Luftlinien-Berechnung (Haversine)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
};

// --- KONFIGURATION ---
const ADMIN_PASSWORD = "quiz"; // DEIN PASSWORT

const firebaseConfig = {
  apiKey: "AIzaSyDS7Dq6toxf3v3ymtMhHkzfxRLA5xgv-g0",
  authDomain: "quizkopp-app.firebaseapp.com",
  projectId: "quizkopp-app",
  storageBucket: "quizkopp-app.firebasestorage.app",
  messagingSenderId: "844811366664",
  appId: "1:844811366664:web:c7a0e7ddf1666e19257cbd"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- HELFER: KONFETTI ANIMATION ---
const Confetti = () => {
  const [particles] = useState(() => Array.from({ length: 120 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    animationDelay: Math.random() * 3,
    color: ['#E69F00', '#10B981', '#3B82F6', '#EF4444', '#F472B6', '#A855F7'][Math.floor(Math.random() * 6)],
    size: Math.random() * 8 + 6
  })));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map(p => (
        <div key={p.id} 
             className="absolute top-[-5vh] rounded-sm opacity-80"
             style={{
               left: `${p.left}%`,
               width: `${p.size}px`,
               height: `${p.size}px`,
               backgroundColor: p.color,
               animation: `fall 3.5s linear ${p.animationDelay}s infinite`
             }}
        />
      ))}
      <style>{`
        @keyframes fall {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg) scale(0.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// --- BILDER: EINFÜGEN, VERKLEINERN & IN FIRESTORE SPEICHERN ---
// Eingefügte Bilder werden im Browser verkleinert und als eigener Eintrag in der
// Sammlung "quiz_images" gespeichert. In der Frage steht nur ein kurzer Verweis
// ("fsimg:<id>"), damit das Quiz selbst klein bleibt (Firestore-Limit: 1 MB pro Eintrag).
const FS_IMG_PREFIX = 'fsimg:';
const MAX_IMG_CHARS = 900000; // Sicherheitsabstand zum 1-MB-Limit
const isFsImage = (url) => typeof url === 'string' && url.startsWith(FS_IMG_PREFIX);

const imagePromiseCache = new Map(); // id -> Promise<dataUrl|null>
const imageDataCache = new Map();    // id -> dataUrl (bereits geladen)

const fetchFsImage = (ref) => {
  const id = ref.slice(FS_IMG_PREFIX.length);
  if (!imagePromiseCache.has(id)) {
    const p = getDoc(doc(db, 'quiz_images', id))
      .then(snap => {
        const data = snap.exists() ? snap.data().data : null;
        if (data) imageDataCache.set(id, data);
        return data;
      })
      .catch(err => {
        console.error('Bild konnte nicht geladen werden:', err);
        imagePromiseCache.delete(id);
        return null;
      });
    imagePromiseCache.set(id, p);
  }
  return imagePromiseCache.get(id);
};

const preloadImages = (questions) => {
  (questions || []).forEach(qq => { if (isFsImage(qq?.imgUrl)) fetchFsImage(qq.imgUrl); });
};

const loadImageElement = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Die Datei ist kein lesbares Bild.')); };
  img.src = url;
});

const compressImage = async (blob, maxW = 1920, maxH = 1080) => {
  const img = await loadImageElement(blob);
  let scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const qualities = [0.85, 0.75, 0.65, 0.5];
  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const quality of qualities) {
      let data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality); // ältere Browser ohne WebP
      if (data.length <= MAX_IMG_CHARS) return { data, width: w, height: h };
    }
    scale *= 0.75;
  }
  throw new Error('Das Bild ist auch verkleinert noch zu groß.');
};

const uploadQuizImage = async (blob) => {
  const { data, width, height } = await compressImage(blob);
  const ref = doc(collection(db, 'quiz_images'));
  await setDoc(ref, { data, width, height, createdAt: Date.now() });
  imageDataCache.set(ref.id, data);
  imagePromiseCache.set(ref.id, Promise.resolve(data));
  return FS_IMG_PREFIX + ref.id;
};

// Holt ein Bild aus der Zwischenablage – außer es wurde eindeutig ein Link kopiert.
const getImageFromClipboard = (e) => {
  const cd = e.clipboardData;
  if (!cd) return null;
  const text = (cd.getData('text/plain') || '').trim();
  if (/^(https?:\/\/|\/)\S+$/i.test(text)) return null;
  for (const item of Array.from(cd.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
};

const useResolvedImage = (src) => {
  const initial = isFsImage(src) ? (imageDataCache.get(src.slice(FS_IMG_PREFIX.length)) || null) : src;
  const [resolved, setResolved] = useState(initial);
  useEffect(() => {
    if (!isFsImage(src)) { setResolved(src); return; }
    const cached = imageDataCache.get(src.slice(FS_IMG_PREFIX.length));
    if (cached) { setResolved(cached); return; }
    let alive = true;
    setResolved(null);
    fetchFsImage(src).then(d => { if (alive) setResolved(d); });
    return () => { alive = false; };
  }, [src]);
  return resolved;
};

const QuizImage = ({ src, className = '', placeholderClassName, alt = '' }) => {
  const resolved = useResolvedImage(src);
  if (!resolved) {
    return <div className={placeholderClassName || `${className} flex items-center justify-center text-slate-300 text-sm animate-pulse`}>Bild lädt …</div>;
  }
  return <img src={resolved} className={className} alt={alt} />;
};

// Bildfeld für den Editor: Link eintippen, Bild mit Strg+V einfügen, hineinziehen oder hochladen.
function ImageInput({ value, onChange, variant = 'compact' }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const handleBlob = async (blob) => {
    setBusy(true);
    try {
      const ref = await uploadQuizImage(blob);
      onChange(ref);
    } catch (err) {
      console.error(err);
      alert('Das Bild konnte nicht gespeichert werden: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e) => {
    const file = getImageFromClipboard(e);
    if (file) { e.preventDefault(); handleBlob(file); }
  };
  const onDrop = (e) => {
    setDragOver(false);
    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); handleBlob(file); }
  };
  const dragProps = {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop,
  };
  const fileInput = (
    <input type="file" accept="image/*" ref={fileRef} className="hidden"
      onChange={e => { const f = e.target.files[0]; if (f) handleBlob(f); e.target.value = ''; }} />
  );

  if (variant === 'large') {
    return (
      <div {...dragProps} className={`w-full rounded-2xl border-2 border-dashed p-4 transition-colors ${dragOver ? 'border-sky-500 bg-sky-100' : 'border-sky-200 bg-white'}`}>
        {fileInput}
        {busy ? (
          <div className="h-48 flex items-center justify-center text-sky-600 font-bold animate-pulse">Bild wird verkleinert & gespeichert …</div>
        ) : value ? (
          <div className="relative">
            <QuizImage src={value} className="w-full max-h-[360px] object-contain rounded-xl bg-slate-900" placeholderClassName="h-48 flex items-center justify-center text-slate-300 animate-pulse" />
            <button onClick={() => onChange('')} className="absolute top-2 right-2 bg-white/90 hover:bg-red-500 hover:text-white text-red-500 p-2 rounded-lg shadow transition-colors" title="Bild entfernen"><X size={18}/></button>
          </div>
        ) : (
          <div className="h-32 flex flex-col items-center justify-center text-slate-400 text-sm gap-1">
            <ImageIcon size={32} className="text-sky-200"/>
            <span>Noch kein Bild – Folie aus PowerPoint kopieren und unten einfügen</span>
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <input value="" onChange={() => {}} onPaste={onPaste} disabled={busy}
            placeholder={value ? 'Zum Ersetzen hier klicken und Strg+V (Mac: ⌘+V) drücken …' : 'Hier klicken und Strg+V (Mac: ⌘+V) drücken – oder Bild hierher ziehen'}
            className="flex-1 bg-sky-50 p-3 rounded-xl border border-sky-100 text-sm outline-none focus:border-sky-400 focus:bg-white cursor-pointer" />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="bg-white px-4 rounded-xl border border-sky-200 text-sky-700 font-semibold text-sm hover:bg-sky-50 transition-colors flex items-center gap-2"><Upload size={16}/> Datei</button>
        </div>
      </div>
    );
  }

  return (
    <div {...dragProps} className={`flex-1 min-w-[200px] flex items-center gap-2 rounded ${dragOver ? 'ring-2 ring-sky-400' : ''}`}>
      {fileInput}
      {isFsImage(value) ? (
        <div className="flex-1 flex items-center gap-2 bg-emerald-50 border border-emerald-100 p-1 pr-2 rounded text-xs text-emerald-700">
          <QuizImage src={value} className="h-8 w-12 object-cover rounded" placeholderClassName="h-8 w-12 rounded bg-emerald-100 animate-pulse" />
          <span className="font-bold">Eingefügtes Bild</span>
          <button onClick={() => onChange('')} className="ml-auto p-1 text-red-400 hover:text-red-600" title="Bild entfernen"><X size={14}/></button>
        </div>
      ) : (
        <input disabled={busy} onPaste={onPaste}
          placeholder={busy ? 'Bild wird gespeichert …' : 'Bild / YouTube / MP3 URL – oder Bild mit Strg+V einfügen'}
          className="flex-1 bg-slate-50 p-2 rounded border border-sky-50 text-xs"
          value={value || ''} onChange={e => onChange(e.target.value)} />
      )}
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="p-2 bg-white border border-sky-100 rounded text-sky-600 hover:bg-sky-50" title="Bild vom Computer hochladen"><ImageIcon size={16}/></button>
    </div>
  );
}

// --- HELFER: FOLIEN & NUMMERIERUNG ---
const isInfoItem = (q) => q?.type === 'break' || q?.type === 'slide';
const getQuestionNumber = (questions, idx) => questions.slice(0, idx + 1).filter(q => !isInfoItem(q)).length;
const getQuestionTotal = (questions) => questions.filter(q => !isInfoItem(q)).length;

const toggleFullscreen = () => {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  } catch (e) { console.log('Vollbild nicht möglich:', e); }
};

// Reine Text-Folie (wenn kein Bild eingefügt ist)
const TextSlide = ({ q }) => (
  <div className="w-full h-full bg-gradient-to-br from-sky-600 to-indigo-900 flex flex-col items-center justify-center text-center p-16 text-white">
    <h2 className="text-6xl lg:text-8xl font-black mb-10 leading-tight">{q.q}</h2>
    {q.note && <p className="text-3xl lg:text-4xl font-medium whitespace-pre-line max-w-5xl opacity-90 leading-relaxed">{q.note}</p>}
  </div>
);

const getMediaType = (url) => {
  if (!url) return 'none';
  if (isFsImage(url) || url.startsWith('data:image')) return 'image';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.wav') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.ogg')) return 'audio';
  return 'image';
};

const getYouTubeEmbedUrl = (url) => {
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

const getSortedTeams = (players, room) => {
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

  Object.values(teamsMap).forEach(t => { t.totalScore = t.playerScoreSum + t.estimationScore; });
  return Object.values(teamsMap).sort((a,b) => b.totalScore - a.totalScore);
};

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';
  for (let i = 0; i < 4; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
};

const downloadCSV = (players, room) => {
  const sortedTeams = getSortedTeams(players, room);
  const headers = ["Team-Platz", "Team", "Team-Punkte Gesamt", "Spieler", "Spieler-Punkte (ohne Schätzen)"];
  
  room.questions.forEach((q, i) => {
      headers.push(q.type === 'break' ? `Pause: ${q.q.replace(/,/g, "")}` : q.type === 'slide' ? `Folie: ${(q.q || '').replace(/,/g, "")}` : `F${i+1}: ${q.q.replace(/,/g, "")}`);
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

const getBaseQuestionTemplate = () => ({
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
    startView: 'europe'
});

const getSlideTemplate = () => ({
    ...getBaseQuestionTemplate(),
    type: 'slide',
    showImg: false,
    showAnswers: false,
    timer: 0,
    isJoker: false
});

// --- AUFRÄUMEN: alte Räume & Spieler löschen (läuft im Hintergrund, wenn ein Quiz gestartet wird) ---
const ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000; // Räume älter als 12 Stunden gelten als beendet

const deleteDocsInChunks = async (refs) => {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach(r => batch.delete(r));
    await batch.commit();
  }
};

const deleteRoomWithPlayers = async (roomCode) => {
  const ps = await getDocs(query(collection(db, 'players'), where('roomCode', '==', roomCode)));
  await deleteDocsInChunks([...ps.docs.map(d => d.ref), doc(db, 'rooms', roomCode)]);
};

const cleanupOldData = async (keepRoomCode) => {
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

// --- HAUPT-APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [adminAuth, setAdminAuth] = useState(false);
  
  const [editingQuiz, setEditingQuiz] = useState(null); 

  useEffect(() => {
    signInAnonymously(auth);
    return onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
  }, []);

  // Nur den aktuellen Raum und seine Spieler laden – nicht mehr alle Räume & Spieler, die es je gab
  useEffect(() => {
    if (!user || !currentRoomCode) { setActiveRoom(null); setRoomPlayers([]); setRoomMissing(false); return; }
    let seen = false;
    const unsubR = onSnapshot(doc(db, 'rooms', currentRoomCode), snap => {
      if (snap.exists()) { seen = true; setRoomMissing(false); setActiveRoom({ id: snap.id, ...snap.data() }); }
      else { setActiveRoom(null); if (seen) setRoomMissing(true); }
    });
    const unsubP = onSnapshot(query(collection(db, 'players'), where('roomCode', '==', currentRoomCode)), s => setRoomPlayers(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsubR(); unsubP(); };
  }, [user, currentRoomCode]);

  const players = [...roomPlayers].sort((a,b) => b.score - a.score);
  const myProfile = roomPlayers.find(p => p.id === user?.uid);

  const roomExists = async (code) => (await getDoc(doc(db, 'rooms', code))).exists();
  const leaveRoom = () => { setRole(null); setCurrentRoomCode(''); setRoomMissing(false); };

  useEffect(() => {
    let interval;
    if (role === 'host' && activeRoom?.status === 'active' && activeRoom?.timeLeft > 0 && !activeRoom?.buzzerWinner) {
      interval = setInterval(async () => {
        const newTime = activeRoom.timeLeft - 1;
        await updateDoc(doc(db, 'rooms', currentRoomCode), { timeLeft: newTime });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [role, activeRoom?.status, activeRoom?.timeLeft, activeRoom?.buzzerWinner]);

  const createRoom = async (questions, allowJokers = true) => {
    const code = generateRoomCode();
    await setDoc(doc(db, 'rooms', code), {
      hostId: user.uid, status: 'lobby', currentQuestionIndex: 0, currentStepIndex: 0, questions,
      timeLeft: questions[0].timer || 0, buzzerWinner: null, buzzerLockedOut: [], teamScores: {}, allowJokers: allowJokers, createdAt: Date.now()
    });
    setCurrentRoomCode(code); setRole('host');
    cleanupOldData(code); // im Hintergrund
  };

  const manualCorrect = async (pId, basePointsToAward) => {
    const p = players.find(x => x.id === pId);
    const pUsedJoker = p.jokerQuestion === activeRoom.currentQuestionIndex;
    const multiplier = pUsedJoker ? 2 : 1;
    const finalPoints = basePointsToAward * multiplier;

    const oldAwarded = p.currentAwardedPoints || 0;
    const newScore = p.score - oldAwarded + finalPoints;

    await updateDoc(doc(db, 'players', pId), { 
        score: newScore, 
        corrected: true, 
        wasCorrect: finalPoints > 0,
        currentAwardedPoints: finalPoints
    });
  };

  const handleBuzzerWrongContinue = async () => {
    const pId = activeRoom.buzzerWinner;
    const buzzingPlayer = players.find(p => p.id === pId);
    if (!buzzingPlayer) return;

    const buzzingTeamId = buzzingPlayer.team && buzzingPlayer.team.trim() !== "" ? buzzingPlayer.team.trim() : buzzingPlayer.name;
    const teamMemberIds = players.filter(p => {
        const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
        return tId === buzzingTeamId;
    }).map(p => p.id);

    const currentLockedOut = activeRoom.buzzerLockedOut || [];
    const newLockedOut = [...new Set([...currentLockedOut, ...teamMemberIds])];

    await updateDoc(doc(db, 'rooms', currentRoomCode), {
        buzzerWinner: null,
        buzzerReaction: null,
        buzzerLockedOut: newLockedOut
    });
  };

  const handleBuzzerHost = async (isCorrect) => {
    const pId = activeRoom.buzzerWinner;
    const batch = writeBatch(db);
    
    const buzzingPlayer = players.find(p => p.id === pId);
    const buzzingTeamId = buzzingPlayer && buzzingPlayer.team && buzzingPlayer.team.trim() !== "" ? buzzingPlayer.team.trim() : buzzingPlayer?.name;

    for (const player of players) {
      const playerTeamId = player.team && player.team.trim() !== "" ? player.team.trim() : player.name;
      const pUsedJoker = player.jokerQuestion === activeRoom.currentQuestionIndex;
      const winPts = pUsedJoker ? 2 : 1;

      if (isCorrect) {
        const isWinner = player.id === pId;
        batch.update(doc(db, 'players', player.id), { 
            score: isWinner ? player.score + winPts : player.score, 
            wasCorrect: isWinner,
            ...(isWinner ? {[`answers.${activeRoom.currentQuestionIndex}`]: true} : {})
        });
      } else {
        const isOtherTeam = playerTeamId !== buzzingTeamId;
        batch.update(doc(db, 'players', player.id), { 
            score: isOtherTeam ? player.score + 1 : player.score, 
            wasCorrect: isOtherTeam,
            ...(isOtherTeam ? {[`answers.${activeRoom.currentQuestionIndex}`]: true} : {})
        });
      }
    }
    
    batch.update(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
    await batch.commit();
  };

  const revealAnswer = async (liveEstValue = null) => {
    if(!activeRoom) return;
    const questionsCopy = [...activeRoom.questions];
    const q = questionsCopy[activeRoom.currentQuestionIndex];
    const batch = writeBatch(db);

    if (q.type === 'estimation') {
      const finalValue = liveEstValue !== null ? liveEstValue : q.correctValue;
      const parsedFinal = parseFloat(String(finalValue).replace(',', '.'));
      
      if (finalValue === "" || isNaN(parsedFinal)) {
          alert("Bitte trage eine gültige Zahl als Lösung ein (z.B. nach dem Wiegen)!");
          return; 
      }
      q.correctValue = String(parsedFinal);
      batch.update(doc(db, 'rooms', currentRoomCode), { questions: questionsCopy });
    }

    if (q.type === 'multiple') {
      for (const p of players) {
        const hasAnswered = p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "";
        const isCorrect = hasAnswered && (p.currentAnswer == q.correctIndex);
        
        const pUsedJoker = p.jokerQuestion === activeRoom.currentQuestionIndex;
        const pts = pUsedJoker ? 2 : 1;

        batch.update(doc(db, 'players', p.id), { score: isCorrect ? p.score + pts : p.score, wasCorrect: isCorrect });
      }
    } else if (q.type === 'estimation') {
      const validPlayers = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "");
      if (validPlayers.length > 0) {
        const target = parseFloat(String(q.correctValue).replace(',', '.'));
        const teams = {};
        for (const p of validPlayers) {
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
          if (!teams[tId]) teams[tId] = { sum: 0, count: 0 };
          teams[tId].sum += parseFloat(String(p.currentAnswer).replace(',', '.'));
          teams[tId].count++;
        }
        let minDiff = Infinity;
        const teamDiffs = {};
        for (const tId in teams) {
          const avg = teams[tId].sum / teams[tId].count;
          const diff = Math.abs(avg - target);
          teamDiffs[tId] = diff;
          if (diff < minDiff) minDiff = diff;
        }
        
        const isBullseye = minDiff < 0.0001; 
        const basePts = isBullseye ? 2 : 1; 

        const winningTeams = Object.keys(teamDiffs).filter(tId => teamDiffs[tId] === minDiff);
        const newTeamScores = { ...(activeRoom.teamScores || {}) };
        
        winningTeams.forEach(tId => {
            const teamUsedJoker = validPlayers.some(p => {
                const ptId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
                return ptId === tId && p.jokerQuestion === activeRoom.currentQuestionIndex;
            });
            
            const finalPts = teamUsedJoker ? basePts * 2 : basePts;
            newTeamScores[tId] = (newTeamScores[tId] || 0) + finalPts;
        });
        
        batch.update(doc(db, 'rooms', currentRoomCode), { teamScores: newTeamScores });

        for (const p of players) {
          const hasAnswered = p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "";
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
          const isCorrect = hasAnswered && winningTeams.includes(tId);
          batch.update(doc(db, 'players', p.id), { 
              wasCorrect: isCorrect,
              isBullseye: isCorrect && isBullseye
          });
        }
      } else {
         for (const p of players) batch.update(doc(db, 'players', p.id), { wasCorrect: false });
      }
    } else if (q.type === 'geo') {
      for (const p of players) batch.update(doc(db, 'players', p.id), { wasCorrect: false });
    }
    
    // Geo: Schritt 1 zeigt nur die Tipps aller Spieler, das Ziel kommt im zweiten Schritt
    batch.update(doc(db, 'rooms', currentRoomCode), { status: 'revealed', ...(q.type === 'geo' ? { geoStage: 'pins' } : {}) });
    await batch.commit();
  };

  if (loading) return <div className="min-h-screen bg-[#F0F9FF] flex items-center justify-center text-[#1E293B] font-bold">Lade Quizkopp...</div>;

  const isSpecialView = role === 'beamer' || role === 'observer';

  return (
    <div className="min-h-screen bg-[#F0F9FF] text-[#1E293B] font-sans">
      <header className="bg-white border-b border-sky-100 p-4 sticky top-0 z-10 shadow-sm">
        <div className={(role === 'host' || role === 'beamer' || role === 'setup') ? "w-full max-w-[1920px] mx-auto px-4 flex justify-between items-center" : "max-w-4xl mx-auto flex justify-between items-center"}>
          <div className="flex items-center gap-2">
              <Trophy className="text-[#E69F00]"/>
              <h1 className="text-xl font-bold italic">
                  Die Quizkopp App 
                  {role === 'beamer' && <span className="text-slate-300 font-normal ml-2">| Beamer</span>}
                  {role === 'observer' && <span className="text-slate-300 font-normal ml-2">| Zuschauer</span>}
              </h1>
          </div>
          <div className="flex items-center gap-4">
          {(role === 'host' || role === 'beamer') && <button onClick={toggleFullscreen} className="text-slate-400 hover:text-sky-500 transition-colors" title="Vollbild an/aus"><Maximize size={20}/></button>}
          {role && <button onClick={() => { if(role==='host' && currentRoomCode) { if (!window.confirm('Quiz wirklich beenden? Der Raum wird für alle geschlossen.')) return; deleteRoomWithPlayers(currentRoomCode).catch(console.error); } leaveRoom(); }} className="text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20}/></button>}
          </div>
        </div>
      </header>

      <main className={(role === 'host' || role === 'beamer') ? "w-full max-w-[1920px] mx-auto p-4 lg:p-8 relative" : role === 'setup' ? "w-full max-w-7xl mx-auto p-4 lg:p-8 relative" : "max-w-4xl mx-auto p-4 py-8 relative"}>
        {!role && !adminAuth && <LoginView onJoin={async (c, n, t) => {
            const roomCode = c.toUpperCase();
            const playerName = n.trim();
            if(!(await roomExists(roomCode))) return alert("Raum nicht gefunden!");
            
            const sameRoom = await getDocs(query(collection(db, 'players'), where('roomCode', '==', roomCode)));
            const existingPlayer = sameRoom.docs.map(d => ({ id: d.id, ...d.data() })).find(p => (p.name || '').toLowerCase() === playerName.toLowerCase());
            
            if (existingPlayer) {
                if (existingPlayer.id !== user.uid) {
                    const { id, ...oldData } = existingPlayer; 
                    await deleteDoc(doc(db, 'players', existingPlayer.id));
                    await setDoc(doc(db, 'players', user.uid), { ...oldData, team: t });
                } else {
                    await updateDoc(doc(db, 'players', user.uid), { team: t });
                }
            } else {
                await setDoc(doc(db,'players',user.uid),{name:playerName, team:t, roomCode:roomCode, score:0, currentAnswer:null, answers:{}, jokerUsed: false, jokerQuestion: null, isBullseye: false, stepLockedIn: null});
            }
            setCurrentRoomCode(roomCode); setRole('player');
        }} onAdmin={() => setAdminAuth('login')} onJoinBeamer={async (c) => {
            const roomCode = c.toUpperCase();
            if(!(await roomExists(roomCode))) return alert("Raum nicht gefunden!");
            setCurrentRoomCode(roomCode); setRole('beamer');
        }} onJoinObserver={async (c) => {
            const roomCode = c.toUpperCase();
            if(!(await roomExists(roomCode))) return alert("Raum nicht gefunden!");
            setCurrentRoomCode(roomCode); setRole('observer');
        }} />}

        {adminAuth === 'login' && <AdminLogin onOk={pw => pw === ADMIN_PASSWORD ? setAdminAuth(true) : alert("Falsch!")} onBack={() => setAdminAuth(false)}/>}
        
        {adminAuth === true && !role && <AdminPanel onNew={() => { setEditingQuiz(null); setRole('setup'); }} onLib={() => setRole('lib')} onLogout={() => setAdminAuth(false)}/>}
        
        {role === 'setup' && <HostSetup onCreate={createRoom} onBack={() => setRole(null)} db={db} initialQuiz={editingQuiz} />}
        
        {role === 'lib' && <Library onSelect={x => createRoom(x.questions, x.allowJokers)} onEdit={quiz => { setEditingQuiz(quiz); setRole('setup'); }} onBack={() => setRole(null)} db={db}/>}

        {(role === 'host' || role === 'beamer') && activeRoom && <HostDashboard room={activeRoom} players={players} isBeamer={role === 'beamer'} onReveal={revealAnswer} onNext={async () => {
            const last = activeRoom.currentQuestionIndex >= activeRoom.questions.length -1;
            const nextIdx = activeRoom.currentQuestionIndex + 1;
            const batch = writeBatch(db);
            for(const p of players) {
              batch.update(doc(db,'players',p.id),{currentAnswer:null, corrected:false, wasCorrect:null, currentAwardedPoints:0, isBullseye: false, stepLockedIn: null});
            }
            batch.update(doc(db,'rooms',currentRoomCode),{
              status:last?'finished':'active',
              currentQuestionIndex:last?activeRoom.currentQuestionIndex:nextIdx,
              currentStepIndex: 0,
              timeLeft:activeRoom.questions[nextIdx]?.timer || 0, 
              buzzerWinner: null, 
              buzzerReaction: null,
              buzzerLockedOut: [],
              geoStage: null
            });
            await batch.commit();
        }} onCorrect={manualCorrect} onBuzzerCorrect={handleBuzzerHost} onBuzzerWrongContinue={handleBuzzerWrongContinue} db={db}/>}

        {role === 'player' && activeRoom && <PlayerDashboard room={activeRoom} player={myProfile} players={players} onAnswer={async v => {
            await updateDoc(doc(db,'players',user.uid),{
                currentAnswer:v,
                [`answers.${activeRoom.currentQuestionIndex}`]:v,
                stepLockedIn: activeRoom.currentStepIndex || 0
            });
        }} onUseJoker={async () => {
            if(window.confirm("Bist du sicher? Der Joker kann nur EINMAL pro Quiz eingesetzt werden!")) {
                await updateDoc(doc(db, 'players', user.uid), { jokerUsed: true, jokerQuestion: activeRoom.currentQuestionIndex });
            }
        }} onBuzz={async (reactionTime) => {
            if(!activeRoom.buzzerWinner && !(activeRoom.buzzerLockedOut || []).includes(user.uid)) {
              await updateDoc(doc(db,'rooms',currentRoomCode),{buzzerWinner: user.uid, buzzerWinnerName: myProfile.name, buzzerReaction: reactionTime});
            }
        }}/>}

        {role === 'observer' && activeRoom && <ObserverDashboard room={activeRoom} players={players} />}

        {(role === 'player' || role === 'beamer' || role === 'observer') && roomMissing && (
          <div className="text-center py-16 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700">
            <div className="text-6xl mb-6">👋</div>
            <h2 className="text-2xl font-bold mb-2">Das Quiz wurde beendet</h2>
            <p className="text-slate-500 mb-8">Danke fürs Mitspielen!</p>
            <button onClick={leaveRoom} className="bg-[#E69F00] text-white px-8 py-3 rounded-xl font-bold shadow-md">Zur Startseite</button>
          </div>
        )}
      </main>
    </div>
  );
}

function LoginView({ onJoin, onAdmin, onJoinBeamer, onJoinObserver }) {
  // Raum-Code aus dem Link übernehmen (z.B. vom QR-Code: ...?raum=AB12)
  const [c, setC] = useState(() => {
    try { return (new URLSearchParams(window.location.search).get('raum') || '').toUpperCase().slice(0, 4); } catch (e) { return ''; }
  });
  const [n, setN] = useState('');
  const [t, setT] = useState(''); 
  const [existingTeams, setExistingTeams] = useState([]);

  // Teams nur für den eingegebenen Raum laden
  useEffect(() => {
    if (c.length !== 4) { setExistingTeams([]); return; }
    const unsub = onSnapshot(query(collection(db, 'players'), where('roomCode', '==', c.toUpperCase())), s => {
      setExistingTeams([...new Set(s.docs.map(d => (d.data().team || '').trim()).filter(Boolean))]);
    }, () => setExistingTeams([]));
    return () => unsub();
  }, [c]);

  return (
    <div className="max-w-md mx-auto pt-10 text-center">
      <img src="/logo.png" alt="Quizkopp Logo" className="w-64 h-auto mx-auto mb-10 drop-shadow-md transition-transform hover:scale-105" />
      <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl space-y-4">
        <input placeholder="RAUM-CODE" className="w-full bg-slate-50 p-4 rounded-xl text-center text-2xl font-mono border border-sky-100 outline-none focus:border-[#E69F00]" value={c} onChange={e=>setC(e.target.value.toUpperCase())} maxLength={4}/>
        <input placeholder="DEIN NAME" className="w-full bg-slate-50 p-4 rounded-xl border border-sky-100 outline-none focus:border-[#E69F00]" value={n} onChange={e=>setN(e.target.value)}/>
        
        <div className="space-y-2">
            <input placeholder="NEUES TEAM (Optional)" className="w-full bg-slate-50 p-4 rounded-xl border border-sky-100 outline-none focus:border-[#E69F00]" value={t} onChange={e=>setT(e.target.value)}/>
            {c.length === 4 && existingTeams.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 justify-center">
                    <span className="text-xs text-slate-400 w-full mb-1">...oder bestehendem Team beitreten:</span>
                    {existingTeams.map(team => (
                        <button key={team} onClick={() => setT(team)} className={`px-4 py-2 text-sm font-semibold rounded-full border transition-colors ${t === team ? 'bg-[#E69F00] text-white border-[#E69F00] shadow-md' : 'bg-white text-slate-500 border-sky-200 hover:border-[#E69F00]'}`}>
                            {team}
                        </button>
                    ))}
                </div>
            )}
        </div>
        
        <button onClick={() => onJoin(c, n, t)} disabled={!c || !n} className="w-full bg-[#E69F00] text-white py-4 rounded-xl font-bold text-lg hover:bg-[#D49100] transition-colors shadow-md disabled:opacity-50 mt-4">Jetzt beitreten</button>
      </div>
      
      <div className="flex flex-col gap-4 mt-16 text-slate-400 text-xs px-4">
          <div className="flex justify-between items-center border-b border-sky-100 pb-4">
              <button onClick={() => { if(c.length === 4) onJoinObserver(c); else alert("Bitte 4-stelligen Raum-Code oben eintragen!"); }} className="hover:text-[#E69F00] font-bold transition-colors flex items-center gap-1">👀 Nur Mitlesen (Handy)</button>
              <button onClick={() => { if(c.length === 4) onJoinBeamer(c); else alert("Bitte 4-stelligen Raum-Code oben eintragen!"); }} className="hover:text-[#E69F00] font-bold transition-colors flex items-center gap-1">📺 Als Beamer</button>
          </div>
          <button onClick={onAdmin} className="hover:text-slate-600 transition-colors mx-auto">Admin-Zentrale</button>
      </div>
    </div>
  );
}

function AdminLogin({ onOk, onBack }) {
  const [pw, setPw] = useState('');
  return (
    <div className="max-w-sm mx-auto bg-white p-8 rounded-3xl border border-sky-100 shadow-2xl mt-10 text-center">
      <h2 className="font-bold mb-6 text-xl">Master-Login</h2>
      <input type="password" placeholder="Passwort" className="w-full bg-slate-50 p-3 rounded mb-4 border border-sky-100 outline-none" value={pw} onChange={e=>setPw(e.target.value)} onKeyPress={e=>e.key==='Enter'&&onOk(pw)} autoFocus/>
      <div className="flex gap-2"><button onClick={onBack} className="flex-1 bg-slate-100 py-2 rounded">Zurück</button><button onClick={()=>onOk(pw)} className="flex-1 bg-[#E69F00] text-white py-2 rounded font-bold shadow-md">Login</button></div>
    </div>
  );
}

function AdminPanel({ onNew, onLib, onLogout }) {
  return (
    <div className="grid md:grid-cols-2 gap-6 pt-10">
      <button onClick={onNew} className="bg-emerald-500 text-white p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform shadow-lg"><Plus size={48}/><span className="text-xl font-bold">Neues Quiz</span></button>
      <button onClick={onLib} className="bg-[#E69F00] text-white p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform shadow-lg"><FolderOpen size={48}/><span className="text-xl font-bold">Bibliothek</span></button>
      <button onClick={onLogout} className="md:col-span-2 text-slate-400 underline mt-10">Abmelden</button>
    </div>
  );
}

function Library({ onSelect, onEdit, onBack, db }) {
  const [t, setT] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);

  useEffect(() => { 
    getDocs(collection(db,'quiz_templates')).then(s => setT(s.docs.map(d => ({id:d.id, ...d.data()})))); 
  }, []);

  const deleteQuiz = async (id) => { 
    if(window.confirm("Bist du sicher?")) { 
      await deleteDoc(doc(db, 'quiz_templates', id)); 
      setT(t.filter(q => q.id !== id)); 
    } 
  };
  
  const folders = [...new Set(t.map(q => q.folder).filter(f => f && f.trim() !== ''))].sort();

  const displayQuizzes = currentFolder 
    ? t.filter(q => q.folder === currentFolder) 
    : t.filter(q => !q.folder || q.folder.trim() === '');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-sky-100 shadow-sm">
        <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-700">
          {currentFolder ? (
            <>
              <button onClick={() => setCurrentFolder(null)} className="p-2 hover:bg-sky-50 text-slate-400 hover:text-sky-600 rounded-lg transition-colors" title="Zurück zur Übersicht">
                <ChevronLeft size={24}/>
              </button> 
              <Folder size={28} className="text-sky-400"/>
              {currentFolder}
            </>
          ) : (
             <>
               <FolderOpen size={28} className="text-[#E69F00]"/> Deine Bibliothek
             </>
          )}
        </h2>
        <button onClick={onBack} className="text-slate-400 hover:text-slate-600 px-4 py-2 font-bold transition-colors">Schließen</button>
      </div>

      {!currentFolder && folders.length > 0 && (
        <div className="mb-10">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">Deine Ordner</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {folders.map(f => {
              const quizCount = t.filter(q => q.folder === f).length;
              return (
                <button key={f} onClick={() => setCurrentFolder(f)} className="bg-white p-6 rounded-2xl flex flex-col items-center gap-3 border border-sky-100 hover:border-sky-300 hover:shadow-md transition-all group">
                  <Folder size={48} className="text-sky-300 group-hover:text-sky-500 transition-colors"/>
                  <div className="text-center w-full">
                      <span className="font-bold text-slate-700 truncate block w-full">{f}</span>
                      <span className="text-xs text-slate-400 font-medium">{quizCount} Quiz{quizCount !== 1 ? 'zes' : ''}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        {!currentFolder && folders.length > 0 && displayQuizzes.length > 0 && (
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 px-2 pt-4 border-t border-sky-100">Quizzes ohne Ordner</h3>
        )}
        
        {displayQuizzes.length === 0 && currentFolder && (
             <div className="text-center py-12 text-slate-400 italic">Dieser Ordner ist leer.</div>
        )}

        <div className="space-y-4">
            {displayQuizzes.map(x => (
              <div key={x.id} className="bg-white p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-sky-50 shadow-sm hover:shadow-md transition-shadow">
                <div>
                  <p className="font-bold text-xl text-slate-700">{x.title}</p>
                  <p className="text-sm text-slate-400">{getQuestionTotal(x.questions || [])} Fragen{(x.questions || []).some(q => q.type === 'slide') && ` · ${(x.questions || []).filter(q => q.type === 'slide').length} Folien`} {x.allowJokers && <span className="text-amber-500 font-bold ml-2">🌟 Joker aktiv</span>}</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button onClick={() => onEdit(x)} className="p-3 text-slate-400 hover:text-[#E69F00] bg-slate-50 rounded-lg transition-colors" title="Quiz bearbeiten"><Edit3 size={20}/></button>
                  <button onClick={() => deleteQuiz(x.id)} className="p-3 text-slate-400 hover:text-red-500 bg-slate-50 rounded-lg transition-colors" title="Quiz löschen"><Trash2 size={20}/></button>
                  <button onClick={() => onSelect(x)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold ml-auto sm:ml-2 shadow-md transition-colors w-full sm:w-auto flex items-center justify-center gap-2"><Play size={20}/> Spielen</button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// --- EDITOR: TYPEN, VORLAGEN & PRÜFUNG ---
const QUESTION_TYPES = [
  { type: 'multiple',   icon: '🔤', label: 'Multiple Choice', desc: '4 Antworten, eine davon ist richtig' },
  { type: 'text',       icon: '✍️', label: 'Freitext',        desc: 'Spieler tippen ihre Antwort, du bewertest' },
  { type: 'estimation', icon: '⚖️', label: 'Schätzfrage',     desc: 'Das Team, das am nächsten dran ist, gewinnt' },
  { type: 'buzzer',     icon: '🔔', label: 'Buzzer',          desc: 'Wer zuerst drückt, darf antworten' },
  { type: 'step',       icon: '🪜', label: 'Stufen-Rätsel',   desc: 'Hinweise nacheinander – früh raten bringt mehr Punkte' },
  { type: 'geo',        icon: '🗺️', label: 'Geo-Quiz',        desc: 'Pin auf der Karte setzen, Entfernung zählt' },
  { type: 'slide',      icon: '🖼️', label: 'Folie',           desc: 'Bild oder Text, z.B. Rundenstart oder Erklärung' },
  { type: 'break',      icon: '⏸️', label: 'Zwischenstand',   desc: 'Zeigt allen das aktuelle Ranking' },
];
const getTypeInfo = (type) => QUESTION_TYPES.find(t => t.type === type) || QUESTION_TYPES[0];

const makeKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const withKey = (q) => (q && q._key ? q : { ...q, _key: makeKey() });

const DEFAULT_GEO = { lat: 51.165691, lng: 10.451526 };

const createItem = (type) => {
  const base = type === 'slide' ? getSlideTemplate() : getBaseQuestionTemplate();
  return applyTypeDefaults({ ...base, type, _key: makeKey() }, type);
};

// Sorgt dafür, dass beim Typwechsel alle nötigen Felder da sind
const applyTypeDefaults = (q, type) => {
  const n = { ...q, type };
  if (type === 'step' && !(n.steps && n.steps.length)) n.steps = [{ text: '', points: 5 }, { text: '', points: 3 }, { text: '', points: 1 }];
  if (type === 'geo') {
    n.targetLat = n.targetLat ?? DEFAULT_GEO.lat;
    n.targetLng = n.targetLng ?? DEFAULT_GEO.lng;
    n.mapStyle = n.mapStyle || 'comic';
    n.startView = n.startView || 'europe';
  }
  if (type === 'slide' || type === 'break') { n.timer = 0; n.isJoker = false; }
  if (type === 'slide') n.showImg = false;
  if (type === 'multiple' && !(n.options && n.options.length === 4)) n.options = ['', '', '', ''];
  return n;
};

const getItemTitle = (q) => {
  if (q.q && q.q.trim()) return q.q.trim();
  if (q.type === 'buzzer') return 'Buzzer-Runde';
  if (q.type === 'break') return 'Zwischenstand';
  if (q.type === 'slide') return q.imgUrl ? 'Folie' : 'Leere Folie';
  return 'Neue Frage';
};

const getWarnings = (q) => {
  const w = [];
  const needsText = ['multiple', 'text', 'estimation', 'step', 'geo'].includes(q.type);
  if (needsText && !(q.q || '').trim()) w.push(q.type === 'step' ? 'Kategorie / Hauptfrage fehlt' : 'Fragetext fehlt');
  if (q.type === 'multiple') {
    const filled = (q.options || []).filter(o => (o || '').trim());
    if (filled.length < 2) w.push('Mindestens 2 Antworten eintragen');
    else if (!((q.options || [])[q.correctIndex] || '').trim()) w.push('Die markierte richtige Antwort ist leer');
  }
  if (q.type === 'step' && !(q.steps || []).some(s => (s.text || '').trim())) w.push('Noch keine Hinweise eingetragen');
  if (q.type === 'geo' && Number(q.targetLat) === DEFAULT_GEO.lat && Number(q.targetLng) === DEFAULT_GEO.lng) w.push('Ziel noch nicht gesetzt (steht auf der Standardposition)');
  if (q.type === 'slide' && !q.imgUrl && !(q.q || '').trim()) w.push('Die Folie ist noch leer');
  if (getMediaType(q.imgUrl) === 'image' && q.imgUrl && !isFsImage(q.imgUrl) && !/^(https?:|\/|data:)/i.test(q.imgUrl)) w.push('Der Medien-Link sieht ungültig aus');
  return w;
};

// Kleine Bausteine für den Editor
const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 cursor-pointer select-none py-1">
    <span className={`mt-0.5 relative inline-flex w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-emerald-500' : 'bg-slate-200'}`}>
      <input type="checkbox" className="sr-only" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </span>
    <span>
      <span className="text-sm font-semibold text-slate-700 block">{label}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </span>
  </label>
);

const FieldLabel = ({ children }) => <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">{children}</label>;

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
    <div className={`bg-white rounded-3xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center px-6 py-4 border-b border-sky-50 sticky top-0 bg-white rounded-t-3xl">
        <h3 className="text-xl font-bold text-slate-700">{title}</h3>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50"><X size={20}/></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

const TypePicker = ({ title, onPick, onClose, currentType }) => (
  <Modal title={title} onClose={onClose} wide>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {QUESTION_TYPES.map(t => (
        <button key={t.type} onClick={() => onPick(t.type)}
          className={`text-left p-4 rounded-2xl border-2 transition-all hover:-translate-y-0.5 hover:shadow-md ${t.type === currentType ? 'border-[#E69F00] bg-amber-50' : 'border-sky-100 bg-white hover:border-sky-300'}`}>
          <div className="text-3xl mb-2">{t.icon}</div>
          <div className="font-bold text-slate-700 text-sm">{t.label}</div>
          <div className="text-xs text-slate-400 mt-1 leading-snug">{t.desc}</div>
        </button>
      ))}
    </div>
  </Modal>
);

function HostSetup({ onCreate, onBack, db, initialQuiz }) {
  const [title, setTitle] = useState(initialQuiz ? initialQuiz.title : '');
  const [folder, setFolder] = useState(initialQuiz ? initialQuiz.folder || '' : '');
  const [allowJokers, setAllowJokers] = useState(initialQuiz ? initialQuiz.allowJokers !== false : true);
  const [qs, setQs] = useState(() => (initialQuiz && initialQuiz.questions && initialQuiz.questions.length ? initialQuiz.questions : [createItem('multiple')]).map(withKey));
  const [selectedKey, setSelectedKey] = useState(null);
  const [picker, setPicker] = useState(null);        // { mode: 'add' | 'change' }
  const [showSettings, setShowSettings] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [toast, setToast] = useState(null);           // { msg, undo }
  const [saveState, setSaveState] = useState(initialQuiz?.id ? 'saved' : 'idle');
  const [importing, setImporting] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const quizIdRef = useRef(initialQuiz?.id || null);
  const firstRender = useRef(true);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);
  const fileInputRef = useRef(null);
  const slideImportRef = useRef(null);
  const slideImportTarget = useRef(null);

  const selectedIndex = Math.max(0, qs.findIndex(q => q._key === selectedKey));
  const selected = qs[selectedIndex] || null;

  useEffect(() => { if (!selectedKey && qs[0]) setSelectedKey(qs[0]._key); }, [selectedKey, qs]);
  useEffect(() => { setShowMore(false); }, [selectedKey]);

  // --- Hinweise unten einblenden (ersetzt die Browser-Popups) ---
  const showToast = (msg, undo = null) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 3500);
  };

  // --- Automatisch speichern ---
  const saveNow = async (data) => {
    const payload = data || { title, folder, allowJokers, qs };
    if (!payload.title.trim()) { setSaveState('needsTitle'); return false; }
    const record = { title: payload.title.trim(), folder: payload.folder.trim(), questions: payload.qs, allowJokers: payload.allowJokers };
    if (JSON.stringify(record).length > 950000) { setSaveState('tooBig'); return false; }
    setSaveState('saving');
    try {
      if (quizIdRef.current) {
        await updateDoc(doc(db, 'quiz_templates', quizIdRef.current), record);
      } else {
        const ref = doc(collection(db, 'quiz_templates'));
        quizIdRef.current = ref.id;
        await setDoc(ref, { ...record, createdAt: Date.now() });
      }
      setSaveState('saved');
      return true;
    } catch (err) {
      console.error(err);
      setSaveState('error');
      return false;
    }
  };

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSaveState(title.trim() ? 'dirty' : 'needsTitle');
    clearTimeout(saveTimer.current);
    const snapshot = { title, folder, allowJokers, qs };
    saveTimer.current = setTimeout(() => saveNow(snapshot), 1200);
    return () => clearTimeout(saveTimer.current);
  }, [title, folder, allowJokers, qs]);

  const flushSave = async () => {
    clearTimeout(saveTimer.current);
    if (saveState === 'dirty' || saveState === 'error') await saveNow();
  };

  // --- Bearbeiten ---
  const updateItem = (key, patch) => setQs(prev => prev.map(q => q._key === key ? { ...q, ...patch } : q));
  const updateStep = (key, sIdx, patch) => setQs(prev => prev.map(q => q._key === key ? { ...q, steps: q.steps.map((s, i) => i === sIdx ? { ...s, ...patch } : s) } : q));

  const insertAfterSelected = (items) => {
    setQs(prev => {
      const idx = prev.findIndex(q => q._key === selectedKey);
      const n = [...prev];
      n.splice(idx === -1 ? n.length : idx + 1, 0, ...items);
      return n;
    });
    setSelectedKey(items[0]._key);
  };

  const addItem = (type) => { insertAfterSelected([createItem(type)]); setPicker(null); };
  const changeType = (type) => { if (selected) updateItem(selected._key, applyTypeDefaults(selected, type)); setPicker(null); };

  const duplicateItem = (key) => {
    const src = qs.find(q => q._key === key);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), _key: makeKey() };
    setQs(prev => { const i = prev.findIndex(q => q._key === key); const n = [...prev]; n.splice(i + 1, 0, copy); return n; });
    setSelectedKey(copy._key);
    showToast('Kopie eingefügt');
  };

  const deleteItem = (key) => {
    const idx = qs.findIndex(q => q._key === key);
    if (idx === -1) return;
    const removed = qs[idx];
    const next = qs.filter(q => q._key !== key);
    setQs(next);
    if (selectedKey === key) setSelectedKey(next[Math.min(idx, next.length - 1)]?._key || null);
    showToast(`„${getItemTitle(removed).slice(0, 40)}“ gelöscht`, () => {
      setQs(prev => { const n = [...prev]; n.splice(Math.min(idx, n.length), 0, removed); return n; });
      setSelectedKey(removed._key);
      setToast(null);
    });
  };

  const moveItem = (key, dir) => setQs(prev => {
    const i = prev.findIndex(q => q._key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const n = [...prev];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  // --- Drag & Drop in der Ablaufliste ---
  const onDragOverItem = (e, index) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };
  const onDropList = (e) => {
    e.preventDefault();
    if (!dragKey || dropIndex === null) { setDragKey(null); setDropIndex(null); return; }
    setQs(prev => {
      const from = prev.findIndex(q => q._key === dragKey);
      if (from === -1) return prev;
      const n = [...prev];
      const [item] = n.splice(from, 1);
      n.splice(dropIndex > from ? dropIndex - 1 : dropIndex, 0, item);
      return n;
    });
    setDragKey(null); setDropIndex(null);
  };

  // --- Globale Aktionen (mit Rückgängig statt Rückfrage) ---
  const applyGlobal = (field, value, label) => {
    const before = qs;
    setQs(qs.map(q => isInfoItem(q) ? q : { ...q, [field]: value }));
    showToast(`${label} – für alle Fragen übernommen`, () => { setQs(before); setToast(null); });
  };

  // --- Folien-Import ---
  const openSlideImport = (atEnd = false) => { slideImportTarget.current = atEnd ? 'end' : 'selected'; slideImportRef.current?.click(); };
  const handleSlideImport = async (e) => {
    const files = Array.from(e.target.files || [])
      .filter(f => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    e.target.value = '';
    if (files.length === 0) return;
    const target = slideImportTarget.current;
    const newSlides = [];
    let failed = 0;
    setImporting({ done: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      try {
        const ref = await uploadQuizImage(files[i]);
        newSlides.push({ ...getSlideTemplate(), imgUrl: ref, q: files[i].name.replace(/\.[^.]+$/, ''), _key: makeKey() });
      } catch (err) { console.error(err); failed++; }
      setImporting({ done: i + 1, total: files.length });
    }
    setImporting(null);
    if (newSlides.length === 0) { showToast('Keine Folie konnte gespeichert werden.'); return; }
    const isEmptyStart = qs.length === 1 && !qs[0].q && !qs[0].imgUrl && qs[0].type === 'multiple';
    if (isEmptyStart) { setQs(newSlides); setSelectedKey(newSlides[0]._key); }
    else if (target === 'end') { setQs(prev => [...prev, ...newSlides]); setSelectedKey(newSlides[0]._key); }
    else insertAfterSelected(newSlides);
    setShowSettings(false);
    showToast(`${newSlides.length} Folie(n) eingefügt${failed ? ` – ${failed} fehlgeschlagen` : ''}`);
  };

  // --- CSV ---
  const downloadCsvTemplate = () => {
    const headers = "Typ;Frage;Option 1;Option 2;Option 3;Option 4;Lösung;Timer;Bild/Video/Audio URL;Notiz\n";
    const rows = [
      "multiple;Wie hoch ist der Eiffelturm?;300m;330m;350m;400m;2;30;;Der Eiffelturm wurde 1889 zur Weltausstellung erbaut.",
      "text;Wer schrieb Faust?;-;-;-;-;Goethe;30;;",
      "estimation;Wie alt wurde die älteste Schildkröte?;-;-;-;-;188;30;;",
      "buzzer;Erkenne dieses Lied (Audio läuft über Beamer);-;-;-;-;Queen - Bohemian Rhapsody;0;/song1.mp3;",
      "slide;Runde 2: Geografie;-;-;-;-;-;0;;Jetzt wird's international!",
      "break;Ende von Runde 1 - Zwischenstand!;-;-;-;-;-;0;;",
    ];
    const blob = new Blob(["﻿" + headers + rows.join("\n") + "\n"], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Quizkopp_Vorlage.csv"; a.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const lines = event.target.result.split(/\r\n|\n|\r/);
      const newQuestions = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(';');
        if (cols.length < 2) continue;
        const type = cols[0].toLowerCase().trim();
        if (!QUESTION_TYPES.some(t => t.type === type)) continue;
        const parsedQ = createItem(type);
        parsedQ.q = cols[1] || "";
        if (type === 'multiple') parsedQ.options = [cols[2] || "", cols[3] || "", cols[4] || "", cols[5] || ""];
        parsedQ.correctIndex = (parseInt(cols[6]) - 1) || 0;
        parsedQ.correctValue = cols[6] && cols[6] !== '-' ? cols[6] : "";
        parsedQ.timer = parseInt(cols[7]) || 0;
        parsedQ.imgUrl = cols[8] || "";
        parsedQ.note = cols[9] || "";
        newQuestions.push(parsedQ);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (newQuestions.length === 0) { showToast('Keine gültigen Fragen gefunden – bitte Format prüfen.'); return; }
      const before = qs;
      const isEmptyStart = qs.length === 1 && !qs[0].q && !qs[0].imgUrl && qs[0].type === 'multiple';
      setQs(isEmptyStart ? newQuestions : [...qs, ...newQuestions]);
      setSelectedKey(newQuestions[0]._key);
      setShowSettings(false);
      showToast(`${newQuestions.length} Fragen importiert`, () => { setQs(before); setToast(null); });
    };
    reader.readAsText(file, "UTF-8");
  };

  // --- Start & Zurück ---
  const allWarnings = qs.map(q => ({ q, w: getWarnings(q) })).filter(x => x.w.length > 0);
  const startQuiz = async () => {
    if (qs.length === 0) return showToast('Füge zuerst mindestens ein Element hinzu.');
    if (allWarnings.length > 0 && !window.confirm(`${allWarnings.length} Element(e) haben noch offene Hinweise (⚠️ in der Liste). Trotzdem starten?`)) return;
    await flushSave();
    onCreate(qs, allowJokers);
  };
  const goBack = async () => {
    if (!title.trim() && qs.some(q => (q.q || '').trim() || q.imgUrl) && !window.confirm('Dein Quiz hat noch keinen Titel und wurde deshalb nicht gespeichert. Trotzdem verlassen?')) return;
    await flushSave();
    onBack();
  };

  const questionCount = getQuestionTotal(qs);
  const slideCount = qs.filter(q => q.type === 'slide').length;

  const saveLabel = {
    idle: { text: 'Gib einen Titel ein – dann wird automatisch gespeichert', cls: 'text-slate-400' },
    needsTitle: { text: '✏️ Titel fehlt – noch nicht gespeichert', cls: 'text-amber-600' },
    dirty: { text: '● Änderungen …', cls: 'text-slate-400' },
    saving: { text: '⏳ Speichert …', cls: 'text-sky-500' },
    saved: { text: '✓ Gespeichert', cls: 'text-emerald-600' },
    error: { text: '⚠️ Speichern fehlgeschlagen – versuche es erneut', cls: 'text-red-500' },
    tooBig: { text: '⚠️ Quiz zu groß zum Speichern', cls: 'text-red-500' },
  }[saveState];

  // --- Detail-Bereich für das ausgewählte Element ---
  const renderDetail = (q) => {
    const info = getTypeInfo(q.type);
    const warnings = getWarnings(q);
    const isQuestion = !isInfoItem(q);
    const supportsShowAnswers = ['multiple', 'estimation'].includes(q.type);
    const moreBadges = [
      q.timer > 0 && q.type !== 'buzzer' && `⏱ ${q.timer}s`,
      allowJokers && q.isJoker && '🌟 Joker',
      q.imgUrl && q.showImg && '📱 Medien aufs Handy',
      supportsShowAnswers && q.showAnswers === false && '🙈 Antworten verborgen',
    ].filter(Boolean);

    return (
      <div className="bg-white rounded-3xl border border-sky-100 shadow-md">
        {/* Kopfzeile */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-sky-50">
          <button onClick={() => setPicker({ mode: 'change' })} className="flex items-center gap-2 bg-slate-50 hover:bg-amber-50 border border-sky-100 hover:border-[#E69F00] px-4 py-2 rounded-xl transition-colors" title="Typ ändern">
            <span className="text-xl">{info.icon}</span>
            <span className="font-bold text-slate-700">{info.label}</span>
            <span className="text-xs text-slate-400 ml-1">ändern</span>
          </button>
          <span className="text-sm text-slate-400 font-medium">{selectedIndex + 1} von {qs.length}{isQuestion && ` · Frage ${getQuestionNumber(qs, selectedIndex)}`}</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => moveItem(q._key, -1)} disabled={selectedIndex === 0} className="p-2 rounded-lg text-slate-400 hover:bg-sky-50 disabled:opacity-30" title="Nach oben"><ArrowUp size={18}/></button>
            <button onClick={() => moveItem(q._key, 1)} disabled={selectedIndex === qs.length - 1} className="p-2 rounded-lg text-slate-400 hover:bg-sky-50 disabled:opacity-30" title="Nach unten"><ArrowDown size={18}/></button>
            <button onClick={() => duplicateItem(q._key)} className="p-2 rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-600" title="Duplizieren"><Copy size={18}/></button>
            <button onClick={() => deleteItem(q._key)} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Löschen"><Trash2 size={18}/></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
              {warnings.map(w => <div key={w}>⚠️ {w}</div>)}
            </div>
          )}

          {/* Titel / Frage */}
          <div>
            <FieldLabel>{q.type === 'slide' ? 'Titel der Folie' : q.type === 'break' ? 'Überschrift' : q.type === 'step' ? 'Kategorie / Hauptfrage' : 'Frage'}</FieldLabel>
            <textarea rows={q.type === 'break' || q.type === 'slide' ? 1 : 2}
              placeholder={q.type === 'break' ? 'z.B. Zwischenstand nach Runde 1' : q.type === 'slide' ? "z.B. 'Regeln Runde 2' – erscheint in der Regie-Vorschau" : q.type === 'step' ? "z.B. 'Wer bin ich?'" : q.type === 'buzzer' ? 'Frage (oder leer lassen für eine reine Buzzer-Runde)' : 'Wie lautet deine Frage?'}
              className="w-full bg-slate-50 p-4 rounded-2xl border border-sky-100 outline-none focus:border-[#E69F00] focus:bg-white text-xl font-bold text-slate-700 resize-none"
              value={q.q} onChange={e => updateItem(q._key, { q: e.target.value })} />
          </div>

          {/* Folie */}
          {q.type === 'slide' && (
            <div className="space-y-3">
              <ImageInput variant="large" value={q.imgUrl} onChange={v => updateItem(q._key, { imgUrl: v })} />
              {!q.imgUrl && (
                <div>
                  <FieldLabel>Text der Folie (ohne Bild)</FieldLabel>
                  <textarea placeholder="Der Titel wird zur Überschrift, dieser Text steht darunter …" className="w-full bg-slate-50 p-3 rounded-xl border border-sky-100 text-slate-700 resize-none h-24 outline-none focus:border-[#E69F00]" value={q.note || ''} onChange={e => updateItem(q._key, { note: e.target.value })} />
                </div>
              )}
              <Toggle checked={q.showImg} onChange={v => updateItem(q._key, { showImg: v })} label="📱 Folie auch auf den Handys zeigen" hint="Sonst steht dort „Schau nach vorne!“" />
            </div>
          )}

          {q.type === 'break' && (
            <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">Auf dem Beamer erscheint das aktuelle Team-Ranking, auf den Handys der eigene Platz.</p>
          )}

          {/* Medien */}
          {isQuestion && (
            <div>
              <FieldLabel>Bild, Video oder Audio (optional)</FieldLabel>
              <ImageInput value={q.imgUrl} onChange={v => updateItem(q._key, { imgUrl: v })} />
              {q.imgUrl && getMediaType(q.imgUrl) === 'image' && (
                <QuizImage src={q.imgUrl} className="mt-3 max-h-40 rounded-xl border border-sky-100 bg-slate-50 object-contain" placeholderClassName="mt-3 h-24 w-40 rounded-xl bg-slate-50 animate-pulse" />
              )}
            </div>
          )}

          {/* Multiple Choice */}
          {q.type === 'multiple' && (
            <div>
              <FieldLabel>Antworten – klicke auf den Buchstaben der richtigen</FieldLabel>
              <div className="grid sm:grid-cols-2 gap-3">
                {(q.options || []).map((o, oi) => {
                  const isRight = Number(q.correctIndex) === oi;
                  return (
                    <div key={oi} className={`flex items-center gap-3 p-2 rounded-2xl border-2 transition-colors ${isRight ? 'border-emerald-400 bg-emerald-50' : 'border-sky-100 bg-slate-50'}`}>
                      <button onClick={() => updateItem(q._key, { correctIndex: oi })} className={`w-10 h-10 rounded-xl font-black flex-shrink-0 transition-colors ${isRight ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400 border border-sky-100 hover:border-emerald-400'}`} title="Als richtige Antwort markieren">
                        {isRight ? '✓' : 'ABCD'[oi]}
                      </button>
                      <input className="bg-transparent w-full text-slate-700 outline-none font-medium" placeholder={`Antwort ${'ABCD'[oi]}`} value={o}
                        onChange={e => updateItem(q._key, { options: q.options.map((x, xi) => xi === oi ? e.target.value : x) })} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lösung */}
          {['text', 'estimation', 'buzzer', 'step'].includes(q.type) && (
            <div>
              <FieldLabel>{q.type === 'estimation' ? 'Richtige Zahl' : 'Lösung (nur für dich)'}</FieldLabel>
              <input type={q.type === 'estimation' ? 'number' : 'text'} className="w-full bg-slate-50 p-3 rounded-xl border border-sky-100 text-slate-700 outline-none focus:border-[#E69F00]"
                value={q.correctValue} onChange={e => updateItem(q._key, { correctValue: e.target.value })}
                placeholder={q.type === 'estimation' ? 'Leer lassen, wenn du das Ergebnis erst live einträgst (z.B. nach dem Wiegen)' : 'z.B. Goethe'} />
            </div>
          )}

          {/* Stufen-Rätsel */}
          {q.type === 'step' && (
            <div>
              <FieldLabel>Hinweise & Punkte</FieldLabel>
              <div className="space-y-2">
                {(q.steps || []).map((step, sIdx) => (
                  <div key={sIdx} className="flex gap-2 items-center">
                    <span className="font-black text-sky-300 w-6 text-right">{sIdx + 1}.</span>
                    <input placeholder={`Hinweis ${sIdx + 1} …`} className="flex-1 p-3 rounded-xl bg-slate-50 border border-sky-100 outline-none focus:border-[#E69F00]" value={step.text} onChange={e => updateStep(q._key, sIdx, { text: e.target.value })} />
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-100 rounded-xl px-2">
                      <input type="number" className="w-12 py-3 bg-transparent text-center font-bold text-[#E69F00] outline-none" value={step.points} onChange={e => updateStep(q._key, sIdx, { points: Number(e.target.value) })} title="Punkte für diesen Hinweis" />
                      <span className="text-xs text-amber-500 font-bold pr-1">Pkt</span>
                    </div>
                    <button onClick={() => updateItem(q._key, { steps: q.steps.filter((_, i) => i !== sIdx) })} className="text-slate-300 p-2 hover:text-red-500 rounded-xl"><Trash2 size={18}/></button>
                  </div>
                ))}
              </div>
              <button onClick={() => updateItem(q._key, { steps: [...(q.steps || []), { text: '', points: 1 }] })} className="text-sm text-sky-600 font-bold hover:text-sky-800 flex items-center gap-1 mt-3">
                <Plus size={16}/> Weiteren Hinweis hinzufügen
              </button>
            </div>
          )}

          {/* Geo */}
          {q.type === 'geo' && (
            <div className="space-y-4">
              <div>
                <FieldLabel>📍 Ziel auf der Karte anklicken</FieldLabel>
                <div className="w-full rounded-2xl overflow-hidden border border-sky-200 z-0 relative" style={{ height: '320px' }}>
                  <MapErrorBoundary>
                    <GeoMap key={`admin-${q._key}`} lat={q.targetLat ?? DEFAULT_GEO.lat} lng={q.targetLng ?? DEFAULT_GEO.lng} isTarget={true} hideLabels={false}
                      onMapClick={(p) => updateItem(q._key, { targetLat: p.lat, targetLng: p.lng })} />
                  </MapErrorBoundary>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Kartenstil</FieldLabel>
                  <select className="w-full bg-slate-50 p-3 rounded-xl border border-sky-100 text-slate-700 font-medium" value={q.mapStyle || 'comic'} onChange={e => updateItem(q._key, { mapStyle: e.target.value })}>
                    {Object.entries(MAP_STYLES).map(([k, st]) => <option key={k} value={k}>{st.label}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Startausschnitt auf den Handys</FieldLabel>
                  <select className="w-full bg-slate-50 p-3 rounded-xl border border-sky-100 text-slate-700 font-medium" value={q.startView || 'europe'} onChange={e => updateItem(q._key, { startView: e.target.value })}>
                    {Object.entries(MAP_VIEWS).map(([k, vw]) => <option key={k} value={k}>{vw.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <FieldLabel>👀 Vorschau: So sehen es die Spieler</FieldLabel>
                <div className="w-full max-w-md rounded-2xl overflow-hidden border border-sky-200 z-0 relative" style={{ height: '260px' }}>
                  <MapErrorBoundary>
                    <GeoMap key={`preview-${q._key}-${q.mapStyle || 'comic'}-${q.startView || 'europe'}`} hideLabels={true} isTarget={false} mapStyle={q.mapStyle || 'comic'} startView={q.startView || 'europe'} />
                  </MapErrorBoundary>
                </div>
              </div>
            </div>
          )}

          {/* Fun Fact */}
          {isQuestion && (
            <div>
              <FieldLabel>💡 Fun Fact zur Auflösung (optional)</FieldLabel>
              <textarea placeholder="Wird nach dem Auflösen auf dem Beamer gezeigt …" className="w-full bg-slate-50 p-3 rounded-xl border border-sky-100 text-slate-700 text-sm resize-none h-20 outline-none focus:border-[#E69F00]" value={q.note || ''} onChange={e => updateItem(q._key, { note: e.target.value })} />
            </div>
          )}

          {/* Mehr Optionen */}
          {isQuestion && (
            <div className="border border-sky-100 rounded-2xl">
              <button onClick={() => setShowMore(!showMore)} className="w-full flex flex-wrap items-center gap-2 px-4 py-3 text-left">
                <span className="font-bold text-slate-600">⚙️ Mehr Optionen</span>
                {moreBadges.map(b => <span key={b} className="text-xs bg-sky-50 text-sky-700 px-2 py-1 rounded-lg font-semibold">{b}</span>)}
                <span className="ml-auto text-slate-400 text-sm">{showMore ? '▲' : '▼'}</span>
              </button>
              {showMore && (
                <div className="px-4 pb-4 space-y-2 border-t border-sky-50 pt-3">
                  {q.type !== 'buzzer' && (
                    <div className="flex items-center gap-3 py-1">
                      <Clock size={18} className="text-[#E69F00]"/>
                      <span className="text-sm font-semibold text-slate-700">Timer</span>
                      <input type="number" min="0" className="w-20 bg-slate-50 p-2 rounded-lg border border-sky-100 text-center" value={q.timer} onChange={e => updateItem(q._key, { timer: parseInt(e.target.value) || 0 })} />
                      <span className="text-xs text-slate-400">Sekunden (0 = ohne Zeitlimit)</span>
                    </div>
                  )}
                  {allowJokers && <Toggle checked={q.isJoker} onChange={v => updateItem(q._key, { isJoker: v })} label="🌟 Joker bei dieser Frage erlauben" hint="Teams können hier ihre Punkte verdoppeln" />}
                  {q.imgUrl && <Toggle checked={q.showImg} onChange={v => updateItem(q._key, { showImg: v })} label="📱 Bild / Medien auch auf den Handys zeigen" />}
                  {supportsShowAnswers && <Toggle checked={q.showAnswers !== false} onChange={v => updateItem(q._key, { showAnswers: v })} label="📺 Antworten der Spieler auf dem Beamer zeigen" />}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Kopfzeile */}
      <div className="bg-white p-4 md:p-5 rounded-3xl border border-sky-100 shadow-sm flex flex-wrap items-center gap-4">
        <button onClick={goBack} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-xl" title="Zurück"><ChevronLeft size={24}/></button>
        <div className="flex-1 min-w-[220px]">
          <input placeholder="Wie heißt dein Quiz?" className="bg-transparent text-2xl font-bold outline-none w-full text-slate-700 placeholder:text-slate-300" value={title} onChange={e => setTitle(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs">
            <span className="flex items-center gap-1 text-slate-400">
              <FolderOpen size={14}/>
              <input placeholder="Ordner (optional)" className="bg-transparent outline-none text-slate-500 w-36" value={folder} onChange={e => setFolder(e.target.value)} />
            </span>
            <span className={`font-semibold ${saveLabel.cls}`}>{saveLabel.text}</span>
          </div>
        </div>
        <button onClick={() => setShowSettings(true)} className="px-4 py-3 rounded-xl border border-sky-100 text-slate-600 font-bold hover:bg-slate-50 flex items-center gap-2">⚙️ <span className="hidden sm:inline">Quiz-Einstellungen</span></button>
        <button onClick={startQuiz} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-md flex items-center gap-2"><Play size={18}/> Quiz starten</button>
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* Ablaufliste */}
        <div className="bg-white rounded-3xl border border-sky-100 shadow-sm lg:sticky lg:top-24">
          <div className="px-5 py-4 border-b border-sky-50 flex justify-between items-baseline">
            <h3 className="font-bold text-slate-700">Ablauf</h3>
            <span className="text-xs text-slate-400">{questionCount} Fragen · {slideCount} Folien</span>
          </div>
          <div className="p-2 max-h-[60vh] overflow-y-auto" onDragOver={e => e.preventDefault()} onDrop={onDropList}>
            {qs.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Noch leer – füge unten etwas hinzu.</p>}
            {qs.map((q, i) => {
              const info = getTypeInfo(q.type);
              const isSel = q._key === selected?._key;
              const warn = getWarnings(q).length > 0;
              return (
                <div key={q._key}>
                  {dropIndex === i && dragKey && <div className="h-1 bg-[#E69F00] rounded-full mx-2 my-1" />}
                  <div draggable
                    onDragStart={e => { setDragKey(q._key); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDragKey(null); setDropIndex(null); }}
                    onDragOver={e => onDragOverItem(e, i)}
                    onClick={() => setSelectedKey(q._key)}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isSel ? 'bg-amber-50 ring-2 ring-[#E69F00]' : 'hover:bg-slate-50'} ${dragKey === q._key ? 'opacity-40' : ''} ${isInfoItem(q) ? 'bg-slate-50/60' : ''}`}>
                    <span className="text-slate-300 cursor-grab text-xs" title="Ziehen zum Verschieben">⋮⋮</span>
                    {q.type === 'slide' && q.imgUrl ? (
                      <QuizImage src={q.imgUrl} className="w-12 h-8 object-cover rounded-md border border-sky-100 flex-shrink-0" placeholderClassName="w-12 h-8 rounded-md bg-slate-100 flex-shrink-0" />
                    ) : (
                      <span className="w-12 h-8 flex items-center justify-center rounded-md bg-slate-100 text-lg flex-shrink-0">{info.icon}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${isInfoItem(q) ? 'text-slate-500 italic' : 'font-semibold text-slate-700'}`}>{getItemTitle(q)}</div>
                      <div className="text-[11px] text-slate-400 flex gap-2">
                        <span>{isInfoItem(q) ? info.label : `Frage ${getQuestionNumber(qs, i)} · ${info.label}`}</span>
                        {allowJokers && q.isJoker && <span>🌟</span>}
                      </div>
                    </div>
                    {warn && <span className="text-amber-500 text-sm" title={getWarnings(q).join('\n')}>⚠️</span>}
                    <button onClick={e => { e.stopPropagation(); duplicateItem(q._key); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-sky-600 p-1" title="Duplizieren"><Copy size={14}/></button>
                    <button onClick={e => { e.stopPropagation(); deleteItem(q._key); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 p-1" title="Löschen"><Trash2 size={14}/></button>
                  </div>
                </div>
              );
            })}
            {dropIndex === qs.length && dragKey && <div className="h-1 bg-[#E69F00] rounded-full mx-2 my-1" />}
          </div>
          <div className="p-3 border-t border-sky-50 grid grid-cols-2 gap-2">
            <button onClick={() => setPicker({ mode: 'add' })} className="bg-[#E69F00] hover:bg-[#D49100] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm"><Plus size={18}/> Hinzufügen</button>
            <button onClick={() => openSlideImport(false)} disabled={!!importing} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 text-sm">
              {importing ? `${importing.done}/${importing.total} …` : <><ImageIcon size={16}/> Folien</>}
            </button>
          </div>
        </div>

        {/* Detail */}
        <div>
          {selected ? renderDetail(selected) : (
            <div className="bg-white rounded-3xl border-2 border-dashed border-sky-200 p-16 text-center text-slate-400">
              <div className="text-5xl mb-4">✨</div>
              <p className="mb-6">Dein Quiz ist noch leer.</p>
              <button onClick={() => setPicker({ mode: 'add' })} className="bg-[#E69F00] text-white px-6 py-3 rounded-xl font-bold">Erstes Element hinzufügen</button>
            </div>
          )}
        </div>
      </div>

      {/* Versteckte Datei-Eingaben */}
      <input type="file" accept="image/*" multiple ref={slideImportRef} onChange={handleSlideImport} className="hidden" />
      <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {picker && (
        <TypePicker title={picker.mode === 'add' ? 'Was möchtest du hinzufügen?' : 'Typ ändern'} currentType={picker.mode === 'change' ? selected?.type : null}
          onPick={picker.mode === 'add' ? addItem : changeType} onClose={() => setPicker(null)} />
      )}

      {showSettings && (
        <Modal title="⚙️ Quiz-Einstellungen" onClose={() => setShowSettings(false)}>
          <div className="space-y-6">
            <div>
              <Toggle checked={allowJokers} onChange={setAllowJokers} label="🌟 Joker-Modus" hint="Jedes Team darf einmal pro Quiz bei einer Joker-Frage seine Punkte verdoppeln" />
            </div>

            <div>
              <FieldLabel>Für alle Fragen auf einmal</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => applyGlobal('showAnswers', true, '👁️ Antworten zeigen')} className="text-sm bg-slate-50 hover:bg-sky-50 text-slate-600 px-3 py-3 rounded-xl border border-slate-200">👁️ Antworten zeigen</button>
                <button onClick={() => applyGlobal('showAnswers', false, '🙈 Antworten verbergen')} className="text-sm bg-slate-50 hover:bg-sky-50 text-slate-600 px-3 py-3 rounded-xl border border-slate-200">🙈 Antworten verbergen</button>
                <button onClick={() => applyGlobal('showImg', true, '📱 Bilder aufs Handy')} className="text-sm bg-slate-50 hover:bg-sky-50 text-slate-600 px-3 py-3 rounded-xl border border-slate-200">📱 Bilder aufs Handy</button>
                <button onClick={() => applyGlobal('showImg', false, '🚫 Keine Bilder aufs Handy')} className="text-sm bg-slate-50 hover:bg-sky-50 text-slate-600 px-3 py-3 rounded-xl border border-slate-200">🚫 Keine Bilder aufs Handy</button>
              </div>
            </div>

            <div>
              <FieldLabel>🖼️ Folien aus PowerPoint</FieldLabel>
              <p className="text-xs text-slate-500 mb-3">In PowerPoint: Datei → Exportieren → PNG → „Alle Folien“. Dann hier alle Bilder auf einmal auswählen.</p>
              <button onClick={() => openSlideImport(true)} disabled={!!importing} className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl font-bold text-sm">
                {importing ? `Folien werden gespeichert … ${importing.done}/${importing.total}` : 'Folien ans Ende anhängen'}
              </button>
            </div>

            <div>
              <FieldLabel>📄 Fragen per Excel / CSV</FieldLabel>
              <div className="flex gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-sky-50 hover:bg-sky-100 text-sky-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><Upload size={16}/> CSV importieren</button>
                <button onClick={downloadCsvTemplate} className="flex-1 bg-white border border-sky-100 hover:bg-slate-50 text-slate-600 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><Download size={16}/> Vorlage</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-slate-800 text-white pl-5 pr-2 py-2 rounded-2xl shadow-2xl flex items-center gap-4 max-w-[90vw]">
          <span className="text-sm">{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo} className="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl text-sm font-bold text-[#E69F00]">Rückgängig</button>}
          <button onClick={() => setToast(null)} className="p-2 text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
      )}
    </div>
  );
}

function HostDashboard({ room, players, onReveal, onNext, onCorrect, onBuzzerCorrect, onBuzzerWrongContinue, db, isBeamer = false }) {
  const q = room.questions[room.currentQuestionIndex];
  const nextQ = room.questions[room.currentQuestionIndex + 1]; 
  const isLastQuestion = room.currentQuestionIndex >= room.questions.length - 1;
  const sortedTeams = getSortedTeams(players, room);
  const geoPinsStage = q?.type === 'geo' && room.status === 'revealed' && room.geoStage === 'pins';
  
  const [showBuzzerAnswer, setShowBuzzerAnswer] = useState(false);
  const [numTeams, setNumTeams] = useState(2); 
  const [showSimulator, setShowSimulator] = useState(false);
  const [simPos, setSimPos] = useState({ 
    x: typeof window !== 'undefined' ? window.innerWidth - 420 : 800, 
    y: 80 
  });
  
  const [liveEstValue, setLiveEstValue] = useState('');

  useEffect(() => {
    setShowBuzzerAnswer(false);
    setLiveEstValue(q?.correctValue || '');
  }, [room.currentQuestionIndex, q?.correctValue]);

  // Bilder vorladen: in der Lobby das ganze Quiz, danach immer die nächsten Folien/Fragen
  useEffect(() => {
    if (room.status === 'lobby') preloadImages(room.questions);
    else preloadImages(room.questions.slice(room.currentQuestionIndex, room.currentQuestionIndex + 4));
  }, [room.status, room.currentQuestionIndex]);

  // Schutz gegen Doppelklick / doppelten Tastendruck
  const actionLock = useRef(false);
  const runOnce = async (fn) => {
    if (actionLock.current) return;
    actionLock.current = true;
    try { await fn(); } catch (err) { console.error(err); }
    finally { setTimeout(() => { actionLock.current = false; }, 400); }
  };
  const goNext = () => runOnce(onNext);
  const revealGeoTarget = () => runOnce(() => updateDoc(doc(db, 'rooms', room.id), { geoStage: 'target' }));

  // Weiterschalten per Tastatur oder Presenter-Klicker (→, Leertaste, Bild↓, Enter)
  useEffect(() => {
    if (isBeamer || room.status === 'lobby' || room.status === 'finished' || !q) return;
    const onKey = (e) => {
      if (e.repeat) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (!['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) return;
      if (geoPinsStage) {
        e.preventDefault(); revealGeoTarget();
      } else if (isInfoItem(q) || room.status === 'revealed') {
        e.preventDefault(); goNext();
      } else if (room.status === 'active' && q.type !== 'buzzer') {
        e.preventDefault(); runOnce(() => onReveal(q.type === 'estimation' ? liveEstValue : null));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleSimulator = async () => {
    const demoId = 'demo_' + room.id;
    if (!showSimulator) {
        await setDoc(doc(db, 'players', demoId), {
            name: '📱 Demo Tester', team: 'Test Team', roomCode: room.id, 
            score: 0, currentAnswer: null, answers: {}, jokerUsed: false, jokerQuestion: null
        });
        setShowSimulator(true);
    } else {
        await deleteDoc(doc(db, 'players', demoId));
        setShowSimulator(false);
    }
  };

  const handleDragStart = (e) => {
    e.preventDefault(); 
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = simPos.x;
    const origY = simPos.y;

    const handleDrag = (moveEvent) => {
      setSimPos({
        x: origX + (moveEvent.clientX - startX),
        y: origY + (moveEvent.clientY - startY)
      });
    };

    const handleDrop = () => {
      window.removeEventListener('mousemove', handleDrag);
      window.removeEventListener('mouseup', handleDrop);
    };

    window.addEventListener('mousemove', handleDrag);
    window.addEventListener('mouseup', handleDrop);
  };

  const demoPlayer = players.find(p => p.id === 'demo_' + room.id);

  const generateRandomTeams = async () => {
    if (players.length === 0) return alert("Es sind noch keine Spieler im Raum!");
    if (window.confirm(`Alle Spieler jetzt zufällig auf ${numTeams} Teams aufteilen?`)) {
      const shuffled = [...players].sort(() => 0.5 - Math.random());
      const batch = writeBatch(db);
      
      shuffled.forEach((p, index) => {
        const teamIndex = (index % numTeams) + 1;
        batch.update(doc(db, 'players', p.id), { team: `Team ${teamIndex}` });
      });
      
      await batch.commit();
    }
  };

  const renderEstimationAnswers = () => {
    const answeredPlayers = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "");
    if (answeredPlayers.length === 0) return null;

    const teams = {};
    answeredPlayers.forEach(p => {
        const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
        if (!teams[tId]) teams[tId] = { name: tId, members: [], sum: 0, count: 0, isWinner: false, isBullseye: false };
        teams[tId].members.push(p);
        teams[tId].sum += parseFloat(String(p.currentAnswer).replace(',', '.'));
        teams[tId].count++;
        if (p.wasCorrect) teams[tId].isWinner = true; 
    });

    const target = parseFloat(String(q.correctValue).replace(',', '.'));

    return (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6 mt-8 border-t border-sky-100 pt-8">
            <div className="col-span-full">
                <h3 className="text-xl font-bold text-slate-600 mb-2">Die Schätzungen der Teams</h3>
            </div>
            {Object.values(teams).sort((a,b) => b.isWinner ? 1 : -1).map(t => {
                const teamAvg = t.sum / t.count;
                const isBullseye = Math.abs(teamAvg - target) < 0.0001;
                const teamUsedJoker = t.members.some(m => m.jokerQuestion === room.currentQuestionIndex);

                return (
                  <div key={t.name} className={`p-6 rounded-3xl border-2 ${t.isWinner ? (isBullseye ? 'bg-purple-50 border-purple-500 shadow-lg scale-[1.02] transition-transform' : 'bg-emerald-50 border-emerald-500 shadow-lg scale-[1.02] transition-transform') : 'bg-white border-sky-100 shadow-sm'}`}>
                      <div className="flex justify-between items-start mb-4">
                          <h4 className={`text-xl font-bold ${t.isWinner ? (isBullseye ? 'text-purple-700' : 'text-emerald-700') : 'text-slate-700'}`}>{t.name}</h4>
                          <div className="flex gap-2">
                             {teamUsedJoker && <span className="bg-amber-500 text-white text-sm font-bold px-3 py-1 rounded-full shadow-sm">🌟 x2</span>}
                             {t.isWinner && (
                               isBullseye 
                               ? <span className="bg-purple-600 text-white text-sm font-bold px-3 py-1 rounded-full shadow-sm">🎯 BULLSEYE</span>
                               : <span className="bg-emerald-500 text-white text-sm font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-sm"><Trophy size={14}/> Sieger</span>
                             )}
                          </div>
                      </div>
                      <p className={`text-3xl font-black mb-4 ${t.isWinner ? (isBullseye ? 'text-purple-600' : 'text-emerald-600') : 'text-slate-600'}`}>Ø {+(teamAvg).toFixed(2)}</p>
                      
                      <div className="space-y-2 text-sm">
                          {t.members.map(m => (
                              <div key={m.id} className="flex justify-between items-center bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                                  <span className="text-slate-500">{m.name}</span>
                                  <span className="font-mono font-bold text-slate-700">{m.currentAnswer}</span>
                              </div>
                          ))}
                      </div>
                  </div>
                );
            })}
        </div>
    );
  };

  const renderSimulatorAndButton = () => (
    <>
      {showSimulator && demoPlayer && (
        <div className="fixed w-[360px] h-[700px] max-h-[80vh] bg-white rounded-[2.5rem] border-[12px] border-slate-800 shadow-2xl overflow-hidden z-[100] flex flex-col"
             style={{ left: `${simPos.x}px`, top: `${simPos.y}px` }}>
            <div 
                className="bg-slate-800 text-white text-center py-3 text-xs font-bold tracking-widest relative flex-shrink-0 cursor-move select-none hover:bg-slate-700 transition-colors"
                onMouseDown={handleDragStart}
                title="Gedrückt halten zum Verschieben"
            >
                <span className="opacity-50 mr-2">⋮⋮</span> REGIE-MONITOR (DEMO) <span className="opacity-50 ml-2">⋮⋮</span>
                <button onClick={toggleSimulator} onMouseDown={e => e.stopPropagation()} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-400 cursor-pointer"><XCircle size={16}/></button>
            </div>
            <div className="flex-1 overflow-y-auto bg-[#F0F9FF] p-4 relative custom-scrollbar">
                <PlayerDashboard room={room} player={demoPlayer} players={players} 
                   onAnswer={async v => { 
                       await updateDoc(doc(db, 'players', demoPlayer.id), { 
                           currentAnswer: v, 
                           [`answers.${room.currentQuestionIndex}`]: v,
                           stepLockedIn: room.currentStepIndex || 0 
                       }); 
                   }}
                   onBuzz={async (rt) => { if(!room.buzzerWinner && !(room.buzzerLockedOut || []).includes(demoPlayer.id)) { await updateDoc(doc(db,'rooms',room.id),{buzzerWinner: demoPlayer.id, buzzerWinnerName: demoPlayer.name, buzzerReaction: rt}); } }}
                   onUseJoker={async () => { if(window.confirm("Bist du sicher? Der Joker kann nur EINMAL pro Quiz eingesetzt werden!")) { await updateDoc(doc(db, 'players', demoPlayer.id), { jokerUsed: true, jokerQuestion: room.currentQuestionIndex }); } }}
                />
            </div>
        </div>
      )}

      <div className="fixed bottom-6 right-6 bg-white px-6 py-3 rounded-2xl shadow-2xl border border-sky-100 flex items-center gap-3 z-50">
        <button onClick={toggleSimulator} className={`p-2 rounded-xl transition-colors ${showSimulator ? 'bg-sky-100 text-sky-600' : 'text-slate-400 hover:bg-slate-50'}`} title="Handy-Simulator öffnen/schließen">
            <Smartphone size={24}/>
        </button>
        <div className="w-px h-8 bg-sky-100 mx-2"></div>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Raum-Code</span>
        <span className="font-mono text-2xl font-bold text-[#E69F00]">{room.id}</span>
      </div>
    </>
  );

  if (room.status === 'lobby') return (
    <div className="text-center py-20 space-y-12 relative h-full">
      <div className="flex flex-col md:flex-row items-center justify-center gap-12">
        <div className="bg-white p-5 rounded-3xl shadow-xl border border-sky-100">
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=8&data=${encodeURIComponent(`${window.location.origin}/?raum=${room.id}`)}`}
               alt="QR-Code zum Beitreten" className="w-56 h-56 md:w-64 md:h-64"
               onError={e => { e.currentTarget.parentElement.style.display = 'none'; }} />
          <p className="text-sm font-bold text-slate-500 mt-3">📱 Scannen & mitspielen</p>
        </div>
        <div>
          <p className="text-3xl text-slate-400 uppercase tracking-widest font-bold">Raum-Code</p>
          <h2 className="text-[10rem] leading-none font-mono font-bold text-[#E69F00] tracking-widest">{room.id}</h2>
          <p className="text-lg text-slate-400 font-medium mt-2">{window.location.host}</p>
        </div>
      </div>
      <div className="bg-white p-8 rounded-3xl border border-sky-100 max-w-4xl mx-auto shadow-xl">
        <h3 className="mb-8 font-bold flex items-center justify-center gap-3 text-3xl text-slate-700"><Users size={36}/> Teams ({sortedTeams.length}) | Spieler ({players.length})</h3>
        <div className="flex flex-wrap gap-4 justify-center">{players.map(p=><span key={p.id} className="bg-slate-50 px-6 py-3 rounded-full text-xl font-semibold shadow-sm text-slate-600">{p.name} {p.team && <span className="text-sm font-normal text-slate-400 ml-1">({p.team})</span>}</span>)}</div>
        
        {!isBeamer && players.length > 0 && (
          <div className="mt-12 pt-8 border-t border-sky-100 flex flex-col md:flex-row items-center justify-center gap-6">
            <div>
                <h4 className="mb-4 font-bold text-xl text-slate-500">🎲 Zufällige Teams auslosen</h4>
                <div className="flex items-center gap-4">
                    <span className="text-slate-400 font-medium">Anzahl Teams:</span>
                    <input type="number" min="2" max="20" value={numTeams} onChange={e => setNumTeams(parseInt(e.target.value) || 2)} className="w-20 bg-slate-50 p-3 rounded-xl border border-sky-100 text-center font-bold text-lg outline-none focus:border-[#E69F00]" />
                    <button onClick={generateRandomTeams} className="bg-sky-500 text-white px-6 py-3 rounded-xl font-bold shadow-md hover:bg-sky-600 transition-colors">Auslosen!</button>
                </div>
            </div>
          </div>
        )}
      </div>
      
      {!isBeamer ? (
        <button onClick={()=>updateDoc(doc(db,'rooms',room.id),{status:'active'})} disabled={players.length===0} className="bg-emerald-500 text-white px-24 py-8 rounded-full text-4xl font-bold shadow-xl transition-all mt-10">Quiz starten!</button>
      ) : (
        <p className="text-xl text-slate-400 mt-10 animate-pulse font-bold uppercase tracking-widest">Warte auf Quizmaster...</p>
      )}
      
      {!isBeamer && renderSimulatorAndButton()}
    </div>
  );
  
  if (room.status === 'finished') return (
    <div className="space-y-8 max-w-4xl mx-auto py-10 text-slate-700 relative h-full">
      <Confetti />
      <h2 className="text-center text-6xl text-[#E69F00] font-bold mb-12 relative z-10">🏆 Endstand</h2>
      {sortedTeams.map((t,i)=>(
        <div key={t.name} className={`p-8 rounded-3xl flex justify-between items-center border ${i===0?'bg-yellow-50 border-[#E69F00] shadow-md relative z-10':'bg-white border-sky-50 shadow-sm relative z-10'}`}>
          <div>
              <span className="text-3xl font-bold block">{i+1}. {t.name}</span>
              <span className="text-sm text-slate-400">{t.players.map(p => p.name).join(", ")}</span>
          </div>
          <span className="font-mono text-4xl bg-slate-50 px-6 py-2 rounded-xl text-[#E69F00]">{t.totalScore}</span>
        </div>
      ))}
      {!isBeamer && <button onClick={()=>downloadCSV(players,room)} className="w-full bg-white border border-sky-100 py-6 rounded-3xl flex items-center justify-center gap-4 text-2xl font-bold mt-12 shadow-md text-slate-700 relative z-10"><Download size={32}/> Excel-Export (CSV)</button>}

      {!isBeamer && renderSimulatorAndButton()}
    </div>
  );

  if (q.type === 'slide') {
    return (
      <div className={`fixed inset-0 z-[60] bg-black flex items-center justify-center select-none ${!isBeamer ? 'cursor-pointer' : ''}`} onClick={() => { if (!isBeamer) goNext(); }}>
        {q.imgUrl ? (
          <QuizImage src={q.imgUrl} className="w-full h-full object-contain" placeholderClassName="text-white/40 text-2xl animate-pulse" />
        ) : (
          <TextSlide q={q} />
        )}

        <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="absolute top-4 right-4 bg-white/10 hover:bg-white/30 text-white p-3 rounded-xl opacity-30 hover:opacity-100 transition-opacity" title="Vollbild an/aus">
          <Maximize size={20}/>
        </button>

        {!isBeamer && (
          <div onClick={(e) => e.stopPropagation()} className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 text-white pl-5 pr-3 py-3 rounded-2xl shadow-2xl opacity-40 hover:opacity-100 transition-opacity cursor-default">
            <span className="font-mono text-sm text-[#E69F00] font-bold">{room.id}</span>
            <span className="text-xs text-slate-300 max-w-xs truncate">🔜 {nextQ ? (nextQ.q || (nextQ.type === 'slide' ? 'Folie' : nextQ.type === 'break' ? 'Zwischenstand' : 'Frage')) : 'Endstand'}</span>
            <button onClick={goNext} className="bg-emerald-500 hover:bg-emerald-600 px-6 py-3 rounded-xl font-bold flex items-center gap-2">
              {isLastQuestion ? 'Ergebnisse' : 'Weiter'} <ChevronRight size={20}/>
            </button>
          </div>
        )}
      </div>
    );
  }

  if (q.type === 'break') {
    return (
      <div className="space-y-8 max-w-4xl mx-auto py-10 text-slate-700 relative h-full">
        <h2 className="text-center text-5xl text-[#E69F00] font-bold mb-12">⏸️ {q.q || 'Zwischenstand'}</h2>
        
        <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl mb-8">
            <h3 className="text-2xl font-bold mb-6 text-slate-600 text-center">Aktuelles Ranking</h3>
            <div className="space-y-4">
              {sortedTeams.map((t, i) => (
                <div key={t.name} className={`flex justify-between items-center p-4 rounded-xl border ${i===0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-sky-50'}`}>
                  <span className="text-2xl font-bold text-slate-700">{i+1}. {t.name}</span>
                  <span className="font-mono text-3xl font-bold text-[#E69F00]">{t.totalScore}</span>
                </div>
              ))}
            </div>
        </div>

        {!isBeamer ? (
            <button onClick={goNext} className="w-full bg-emerald-500 text-white px-8 py-6 rounded-3xl text-3xl font-bold shadow-xl hover:scale-[1.02] transition-all">
            {isLastQuestion ? 'Ergebnisse anzeigen' : 'Nächste Runde starten'}
            </button>
        ) : (
            <p className="text-center text-slate-400 mt-8 animate-pulse font-bold uppercase tracking-widest">Warte auf Quizmaster...</p>
        )}

        {!isBeamer && renderSimulatorAndButton()}
      </div>
    );
  }

  // Sichere Geo-Daten für das Host-Reveal
  const safeTargetLat = Number(q.targetLat) || 51.165691;
  const safeTargetLng = Number(q.targetLng) || 10.451526;
  
  // Alle gesetzten Spieler-Pins sammeln
  // Spieler nach Entfernung sortiert (ohne Pin ganz unten) + 3-2-1-Punktevorschlag
  const getGeoDist = (p) => p.currentAnswer?.lat && !isNaN(Number(p.currentAnswer.lat))
      ? calculateDistance(safeTargetLat, safeTargetLng, Number(p.currentAnswer.lat), Number(p.currentAnswer.lng))
      : null;
  const geoSortedPlayers = q.type === 'geo'
      ? [...players].sort((a, b) => (getGeoDist(a) ?? Infinity) - (getGeoDist(b) ?? Infinity))
      : players;
  const awardGeoPoints = async () => {
      const dists = players.map(p => getGeoDist(p)).filter(d => d !== null);
      await Promise.all(players.map(p => {
          const d = getGeoDist(p);
          if (d === null) return onCorrect(p.id, 0);
          const rank = dists.filter(x => x < d).length; // Gleichstand = gleicher Platz
          return onCorrect(p.id, [3, 2, 1][rank] || 0);
      }));
  };

  const playerPins = players.map(p => {
      if (!p.currentAnswer?.lat || isNaN(Number(p.currentAnswer.lat))) return null;
      return {
          id: p.id,
          name: p.team || p.name,
          lat: Number(p.currentAnswer.lat),
          lng: Number(p.currentAnswer.lng),
          dist: calculateDistance(safeTargetLat, safeTargetLng, Number(p.currentAnswer.lat), Number(p.currentAnswer.lng))
      };
  }).filter(Boolean);

  return (
    <>
      <div className="grid lg:grid-cols-4 gap-8 h-full">
        <div className="lg:col-span-3 space-y-6 flex flex-col h-full text-slate-700">
          <div className="bg-white p-8 md:p-12 rounded-3xl border border-sky-100 shadow-2xl relative flex-grow flex flex-col">
            <div className="flex justify-between items-center mb-8">
               <div className="flex flex-wrap items-center gap-3">
                 <span className="text-lg font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-sky-50">Frage {getQuestionNumber(room.questions, room.currentQuestionIndex)}/{getQuestionTotal(room.questions)}</span>
                 {room.allowJokers && (
                   <span className="text-sm font-bold text-amber-600 uppercase tracking-widest bg-amber-50 px-4 py-2 rounded-full border border-amber-200 shadow-sm">
                     🌟 {room.questions.slice(room.currentQuestionIndex).filter(qu => qu.isJoker).length} Joker-Fragen übrig
                   </span>
                 )}
               </div>
               <div className="flex gap-3 ml-auto">
                 {room.status === 'active' && q.type !== 'buzzer' && players.length > 0 && (() => {
                     const answered = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== '').length;
                     const all = answered === players.length;
                     return (
                       <div className={`flex items-center gap-3 font-bold text-2xl px-6 py-2 rounded-full border transition-colors ${all ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-slate-50 border-sky-50 text-slate-500'}`} title="So viele haben schon geantwortet">
                         <CheckCircle size={26}/> {answered}/{players.length}
                         <span className="hidden xl:inline text-base font-semibold">{all ? 'alle da!' : 'geantwortet'}</span>
                       </div>
                     );
                 })()}
                 {q.type !== 'buzzer' && q.type !== 'step' && <div className="flex items-center gap-3 text-[#E69F00] font-mono text-4xl font-bold bg-slate-50 px-6 py-2 rounded-full border border-sky-50"><Clock size={32}/> {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}</div>}
                 {q.type === 'buzzer' && <div className="flex items-center gap-3 text-red-500 font-bold uppercase text-2xl bg-red-50 px-6 py-2 rounded-full text-red-600 animate-pulse"><Bell size={28}/> Buzzer aktiv</div>}
               </div>
            </div>
            
            {q.imgUrl && getMediaType(q.imgUrl) === 'youtube' && (
              <div className="w-full aspect-video rounded-2xl mb-8 overflow-hidden bg-slate-900 shadow-lg border border-sky-50">
                <iframe className="w-full h-full" src={getYouTubeEmbedUrl(q.imgUrl)} title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen></iframe>
              </div>
            )}
            {q.imgUrl && getMediaType(q.imgUrl) === 'audio' && (
              <div className="w-full bg-slate-800 p-8 rounded-2xl mb-8 border border-sky-50 shadow-lg flex items-center justify-center">
                 <audio controls className="w-full max-w-lg"><source src={q.imgUrl} type="audio/mpeg" />Dein Browser unterstützt kein Audio.</audio>
              </div>
            )}
            {q.imgUrl && getMediaType(q.imgUrl) === 'image' && (
              <QuizImage src={q.imgUrl} className="w-full max-h-[45vh] object-contain rounded-2xl mb-8 bg-slate-50 p-4 border border-sky-50"/>
            )}

            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-10 leading-tight">{q.q || (q.type === 'buzzer' ? 'Schnelles Spiel: Buzzer aktiv!' : '')}</h2>

            {q.type === 'step' && room.status === 'active' && (
              <div className="mt-4 space-y-4 mb-8">
                {q.steps && q.steps.slice(0, (room.currentStepIndex || 0) + 1).map((s, idx) => (
                    <div key={idx} className="bg-sky-50 border-2 border-sky-200 p-6 rounded-2xl shadow-sm transition-all animate-[pulse_0.5s_ease-out]">
                        <span className="font-black text-sky-600 text-xl mr-3">Hinweis {idx + 1}:</span>
                        <span className="text-2xl text-slate-800 font-medium">{s.text}</span>
                        <span className="float-right bg-sky-200 text-sky-800 text-sm px-3 py-1 rounded-lg font-bold shadow-sm">{s.points} Punkte</span>
                    </div>
                ))}

                {!isBeamer && q.steps && (room.currentStepIndex || 0) < q.steps.length - 1 && (
                    <button onClick={async () => {
                        await updateDoc(doc(db, 'rooms', room.id), { currentStepIndex: (room.currentStepIndex || 0) + 1 });
                    }} className="w-full bg-sky-100 hover:bg-sky-200 text-sky-700 font-bold py-6 rounded-2xl transition-colors mt-6 shadow-sm border border-sky-200 text-xl flex items-center justify-center gap-2">
                        <Plus size={28}/> Nächsten Hinweis aufdecken
                    </button>
                )}
              </div>
            )}

            {!isBeamer && q.type === 'estimation' && room.status === 'active' && (
              <div className="bg-blue-50 border border-blue-200 p-6 rounded-3xl mb-8 shadow-inner">
                <h3 className="text-lg font-bold text-blue-800 mb-2">⚖️ Live-Ergebnis (Schätzen)</h3>
                <p className="text-sm text-blue-600 mb-4">Wurde im Setup kein Wert eingetragen, kannst du hier das echte Ergebnis (z.B. nach dem Wiegen) direkt eintragen, bevor du auflöst.</p>
                <input 
                  type="number" 
                  className="w-full bg-white p-4 rounded-xl border border-blue-200 text-xl font-bold outline-none focus:border-blue-500 shadow-sm"
                  placeholder="Exaktes Ergebnis eintragen..."
                  value={liveEstValue}
                  onChange={e => setLiveEstValue(e.target.value)}
                />
              </div>
            )}
            
            {/* NATIVE REVEAL MAP (Ohne Text, nur Vektoren-Grenzen) */}
            {q.type === 'geo' && room.status === 'revealed' && (
               <div className="w-full rounded-3xl overflow-hidden border border-sky-200 z-0 relative mb-8 shadow-inner" style={{ height: '62vh', minHeight: '450px' }}>
                  {geoPinsStage && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] bg-slate-900/85 text-white px-6 py-3 rounded-full font-bold text-lg shadow-xl pointer-events-none">
                          📍 {playerPins.length} {playerPins.length === 1 ? 'Tipp' : 'Tipps'} – wo liegt das Ziel?
                      </div>
                  )}
                  <MapErrorBoundary>
                      <GeoMap 
                          key={`reveal-${room.currentQuestionIndex}`}
                          stage={room.geoStage || null}
                          startView={q.startView || 'europe'}
                          lat={safeTargetLat} 
                          lng={safeTargetLng} 
                          isTarget={true} 
                          readOnly={true} 
                          playerPins={playerPins} 
                          hideLabels={true} 
                          mapStyle={q.mapStyle || 'comic'}
                      />
                  </MapErrorBoundary>
               </div>
            )}

            {q.type === 'buzzer' && room.status === 'active' && room.buzzerWinner && (
              <div className="bg-red-50 border-2 border-red-500 p-12 rounded-3xl text-center shadow-2xl animate-pulse mt-auto">
                <p className="text-red-500 font-bold text-xl mb-4 uppercase tracking-widest">Schnellster Buzzer:</p>
                <h3 className="text-6xl md:text-7xl font-black text-slate-800 mb-2">{room.buzzerWinnerName}</h3>
                
                {room.buzzerReaction && (
                    <p className="text-2xl font-bold text-red-500 mb-6 flex items-center justify-center gap-2">
                        <Clock size={24}/> {(room.buzzerReaction / 1000).toFixed(2)} Sekunden
                    </p>
                )}

                {!isBeamer && q.correctValue && (
                    <div className="mb-8">
                        {!showBuzzerAnswer ? (
                            <button onClick={() => setShowBuzzerAnswer(true)} className="text-sm font-bold text-red-400 hover:text-red-600 underline transition-colors">
                                Lösung einblenden (Nur für dich)
                            </button>
                        ) : (
                            <div className="bg-white/80 p-4 rounded-xl border border-red-200 inline-block shadow-inner">
                                <span className="text-xs text-slate-500 uppercase font-bold block mb-1">Lösung:</span>
                                <span className="text-xl font-bold text-slate-800">{q.correctValue}</span>
                            </div>
                        )}
                    </div>
                )}

                {!isBeamer ? (
                    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
                        <button onClick={()=>onBuzzerCorrect(true)} className="bg-emerald-500 text-white px-8 py-5 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 w-full shadow-md hover:bg-emerald-600 transition-colors"><CheckCircle size={28}/> Richtig (+ Punkte)</button>
                        
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button onClick={onBuzzerWrongContinue} className="bg-orange-100 border border-orange-300 text-orange-600 hover:bg-orange-500 hover:text-white px-6 py-4 rounded-2xl font-bold flex-1 flex items-center justify-center gap-2 transition-colors shadow-sm" title="Sperrt den aktuellen Spieler und gibt den Buzzer für die anderen wieder frei."><Bell size={24}/> Falsch (Sperren & Weiter)</button>
                            <button onClick={()=>onBuzzerCorrect(false)} className="bg-red-50 border border-red-200 text-red-500 hover:bg-red-500 hover:text-white px-6 py-4 rounded-2xl font-bold flex-1 flex items-center justify-center gap-2 transition-colors shadow-sm" title="Beendet die Runde und gibt den anderen Teams den Punkt."><XCircle size={24}/> Falsch (Runde beenden)</button>
                        </div>
                    </div>
                ) : (
                    <p className="text-center text-red-400 font-bold uppercase tracking-widest mt-6 animate-pulse">Quizmaster entscheidet...</p>
                )}
              </div>
            )}

            {room.status === 'revealed' && q.type !== 'buzzer' && q.type !== 'geo' && (
              <div className="bg-emerald-50 border border-emerald-500/50 p-8 rounded-2xl mb-6 mt-auto">
                <p className="text-emerald-500 font-bold uppercase tracking-widest mb-2">Korrekte Lösung</p>
                <p className="text-4xl font-bold">
                  {q.type === 'multiple' ? q.options[q.correctIndex] : q.correctValue || "Manuelle Auswertung"}
                </p>
              </div>
            )}
            
            {room.status === 'revealed' && q.type === 'multiple' && q.showAnswers !== false && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-8 border-t border-sky-100 pt-8">
                    <div className="col-span-full"><h3 className="text-xl font-bold text-slate-600 mb-2">Wer hat was getippt?</h3></div>
                    {players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "").map(p => {
                        const pUsedJoker = p.jokerQuestion === room.currentQuestionIndex;
                        return (
                          <div key={p.id} className={`p-4 rounded-xl border-2 relative ${p.wasCorrect ? 'bg-emerald-50 border-emerald-500' : 'bg-slate-50 border-sky-100'}`}>
                              <div className="font-bold text-slate-700 flex justify-between items-center">
                                  <span>{p.name} {p.team && <span className="text-xs text-slate-400 font-normal">({p.team})</span>}</span>
                                  {pUsedJoker && <span className="text-xl" title="Joker gespielt!">🌟</span>}
                              </div>
                              <div className="text-sm mt-1">{q.options[p.currentAnswer]}</div>
                          </div>
                        )
                    })}
                </div>
            )}

            {room.status === 'revealed' && q.type === 'estimation' && q.showAnswers !== false && renderEstimationAnswers()}
            
            {room.status === 'revealed' && !geoPinsStage && (q.type === 'text' || q.type === 'step' || q.type === 'geo') && <div className="space-y-4 mt-8 border-t border-sky-100 pt-8">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <h3 className="text-xl font-bold text-slate-600">{q.type === 'geo' ? '📏 Wer war am nächsten dran?' : 'Antworten bewerten'}</h3>
                {q.type === 'geo' && !isBeamer && (
                  <button onClick={() => runOnce(awardGeoPoints)} className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-4 py-2 rounded-xl font-bold text-sm transition-colors" title="Nächster Tipp 3 Punkte, Zweiter 2, Dritter 1 – du kannst danach noch einzeln ändern">
                    ⚡ Punkte-Vorschlag 3 · 2 · 1 übernehmen
                  </button>
                )}
              </div>
              {geoSortedPlayers.map((p, pIdx) => {
                const pUsedJoker = p.jokerQuestion === room.currentQuestionIndex;
                const mult = pUsedJoker ? 2 : 1;
                
                const hasStepData = q.type === 'step' && p.stepLockedIn !== undefined && p.stepLockedIn !== null;
                const stepInfo = hasStepData ? q.steps[p.stepLockedIn] : null;
                const basePts = stepInfo ? stepInfo.points : 1;
                
                const isGeo = q.type === 'geo';
                const dist = isGeo && p.currentAnswer?.lat ? calculateDistance(safeTargetLat, safeTargetLng, Number(p.currentAnswer.lat), Number(p.currentAnswer.lng)) : null;
                
                return (
                  <div key={p.id} className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center bg-slate-50 p-6 rounded-2xl border border-sky-50 shadow-sm">
                    <div className="pr-4">
                        <span className="text-sm font-bold text-slate-400 uppercase flex items-center gap-2">
                           {p.name} {p.team && <span className="text-xs text-slate-400">({p.team})</span>}
                           {pUsedJoker && <span className="text-amber-500 text-lg" title="Joker eingesetzt!">🌟</span>}
                        </span>
                        
                        {isGeo ? (
                            <p className="text-2xl font-black mt-1 text-slate-700">
                               {dist !== null && !isNaN(dist) && pIdx < 3 ? ['🥇 ', '🥈 ', '🥉 '][pIdx] : ''}
                               {dist !== null && !isNaN(dist) ? `${dist.toFixed(1)} km entfernt` : 'Kein Pin gesetzt'}
                            </p>
                        ) : (
                            <p className="text-2xl italic mt-1 text-slate-700 font-medium">"{p.currentAnswer||'---'}"</p>
                        )}
                        
                        {hasStepData && (
                            <span className="text-xs font-bold text-sky-700 bg-sky-100 px-3 py-1 rounded-md border border-sky-200 mt-2 inline-block">
                                Eingeloggt bei Hinweis {p.stepLockedIn + 1} (Mögliche Punkte: {basePts * mult})
                            </span>
                        )}
                    </div>
                    {!isBeamer ? (
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={()=>onCorrect(p.id, 0)} className={`p-4 rounded-xl shadow-sm transition-all ${p.corrected && p.currentAwardedPoints === 0 ? 'bg-red-500 text-white scale-105' : 'bg-white text-slate-300 hover:text-red-500'}`} title="0 Punkte"><XCircle size={32}/></button>
                            
                            {q.type === 'text' && (
                                <button onClick={()=>onCorrect(p.id, 0.5)} className={`p-4 rounded-xl shadow-sm transition-all font-black text-2xl w-[64px] flex justify-center items-center ${p.corrected && p.currentAwardedPoints === 0.5 * mult ? 'bg-orange-400 text-white scale-105' : 'bg-white text-slate-300 hover:text-orange-400'}`} title={mult === 2 ? "0.5 Punkte (x2 Joker = 1 Punkt)" : "0.5 Punkte"}>½</button>
                            )}

                            {isGeo ? (
                                <>
                                  <button onClick={()=>onCorrect(p.id, 1)} className={`p-4 rounded-xl shadow-sm transition-all font-black text-2xl w-[64px] flex justify-center items-center ${p.corrected && p.currentAwardedPoints === 1 * mult ? 'bg-emerald-400 text-white scale-105' : 'bg-white text-slate-300 hover:text-emerald-400'}`} title={mult === 2 ? "1 Punkt (x2 Joker = 2 Punkte)" : "1 Punkt"}>1</button>
                                  <button onClick={()=>onCorrect(p.id, 2)} className={`p-4 rounded-xl shadow-sm transition-all font-black text-2xl w-[64px] flex justify-center items-center ${p.corrected && p.currentAwardedPoints === 2 * mult ? 'bg-emerald-500 text-white scale-105' : 'bg-white text-slate-300 hover:text-emerald-500'}`} title={mult === 2 ? "2 Punkte (x2 Joker = 4 Punkte)" : "2 Punkte"}>2</button>
                                  <button onClick={()=>onCorrect(p.id, 3)} className={`p-4 rounded-xl shadow-sm transition-all font-black text-2xl w-[64px] flex justify-center items-center ${p.corrected && p.currentAwardedPoints === 3 * mult ? 'bg-emerald-600 text-white scale-105' : 'bg-white text-slate-300 hover:text-emerald-600'}`} title={mult === 2 ? "3 Punkte (x2 Joker = 6 Punkte)" : "3 Punkte"}>3</button>
                                </>
                            ) : (
                                <button onClick={()=>onCorrect(p.id, basePts)} className={`p-4 rounded-xl shadow-sm transition-all flex items-center justify-center gap-1 ${p.corrected && p.currentAwardedPoints === basePts * mult ? 'bg-emerald-500 text-white scale-105' : 'bg-white text-slate-300 hover:text-emerald-500'}`} title={mult === 2 ? `${basePts} Punkte (x2 Joker = ${basePts * 2} Punkte)` : `${basePts} Punkt(e)`}>
                                    <CheckCircle size={32}/> 
                                    {q.type === 'step' && <span className="text-lg font-black">{basePts * mult}</span>}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center font-black text-2xl">
                           {p.corrected ? (p.currentAwardedPoints > 0 ? <span className="text-emerald-500 font-bold">+{p.currentAwardedPoints}</span> : <span className="text-red-500 font-bold">0</span>) : <span className="text-slate-300 animate-pulse font-bold text-sm uppercase">Wartet...</span>}
                        </div>
                    )}
                  </div>
                )
              })}
            </div>}

            {room.status === 'revealed' && !geoPinsStage && q.note && (
              <div className="bg-blue-50 border border-blue-200 p-8 rounded-2xl mb-6 mt-6 shadow-inner">
                <p className="text-blue-600 font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                   <MessageSquare size={20}/> Hintergrundinfo / Fun Fact
                </p>
                <p className="text-xl font-medium text-slate-700 leading-relaxed whitespace-pre-line">{q.note}</p>
              </div>
            )}
          </div>

          {!isBeamer && nextQ && room.status === 'revealed' && (
              <div className="bg-slate-800 p-6 rounded-3xl mb-4 text-white shadow-inner flex items-center justify-between border-l-4 border-sky-400">
                  <div>
                      <span className="text-sky-400 font-bold text-xs uppercase tracking-widest block mb-1">🔜 Regie-Vorschau: Nächste Frage</span>
                      <p className="font-medium text-lg truncate max-w-xl">{nextQ.q || (nextQ.type === 'break' ? '⏸️ Pause / Zwischenstand' : nextQ.type === 'slide' ? '🖼️ Folie' : '---')}</p>
                  </div>
                  <div className="text-right ml-4">
                      <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-lg text-xs font-bold uppercase block mb-1">{nextQ.type === 'slide' ? 'Folie' : nextQ.type}</span>
                      {nextQ.isJoker && <span className="text-amber-400 text-xs font-bold uppercase">🌟 Joker</span>}
                  </div>
              </div>
          )}

          {!isBeamer && (q.type !== 'buzzer' || room.status === 'revealed') && (
            <button onClick={() => room.status === 'active' ? runOnce(() => onReveal(q.type === 'estimation' ? liveEstValue : null)) : geoPinsStage ? revealGeoTarget() : goNext()} className={`w-full py-8 rounded-3xl font-bold text-3xl shadow-xl transition-all hover:scale-[1.02] ${room.status === 'active' || geoPinsStage ? 'bg-[#E69F00] text-white' : 'bg-emerald-500 text-white'}`}>
              {room.status === 'active' ? (q.type === 'geo' ? '📍 Alle Tipps zeigen' : 'Lösung auflösen') : geoPinsStage ? '🎯 Ziel auflösen' : (isLastQuestion ? 'Ergebnisse anzeigen' : 'Nächste Frage')}
            </button>
          )}
        </div>
        
        <div className="bg-white p-8 rounded-3xl border border-sky-100 h-fit sticky top-24 shadow-xl">
          <h3 className="text-2xl font-bold mb-8 uppercase tracking-widest text-slate-300">Team Ranking</h3>
          <div className="space-y-4">
              {sortedTeams.map((t, index) => (
                <div key={t.name} className="bg-slate-50 rounded-xl border border-sky-50 shadow-sm overflow-hidden">
                  <div className="flex justify-between items-center p-4 bg-sky-50/50">
                    <span className="font-bold flex items-center gap-3 text-slate-700">
                      <span className="text-slate-400 text-sm">{index + 1}.</span>
                      {t.name}
                    </span>
                    <span className="font-mono font-bold bg-white px-3 py-1 rounded-lg border border-sky-100 text-[#E69F00] shadow-inner">
                      {t.totalScore}
                    </span>
                  </div>
                  {t.players.length > 0 && (
                    <div className="px-4 py-2 bg-white space-y-2 border-t border-sky-50">
                      {t.players.map(p => {
                        const isReadyOrCorrect = room.status === 'revealed' ? p.wasCorrect === true : ((p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "") || p.id === room.buzzerWinner);
                        const isJokerActiveNow = p.jokerQuestion === room.currentQuestionIndex;
                        
                        return (
                          <div key={p.id} className="flex justify-between text-sm items-center">
                            <span className="text-slate-500 pl-6 truncate pr-2">{p.name}</span>
                            <div className="flex items-center gap-3">
                              {isJokerActiveNow && <span className="text-amber-500 text-sm animate-pulse" title="Joker aktiv!">🌟</span>}
                              {isReadyOrCorrect ? <CheckCircle size={14} className="text-emerald-500"/> : <div className="w-2 h-2 rounded-full bg-slate-200 animate-pulse mt-1"/>}
                              <span className="font-mono text-xs text-slate-400 w-6 text-right">{p.score}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      {!isBeamer && renderSimulatorAndButton()}
    </>
  );
}

function PlayerDashboard({ room, player, players, onAnswer, onBuzz, onUseJoker }) {
  if (!player) return null;
  const q = room.questions[room.currentQuestionIndex];
  
  const [v, setV] = useState(q.type === 'geo' ? null : '');
  const [qStartTime, setQStartTime] = useState(Date.now());
  const sortedTeams = getSortedTeams(players, room);
  
  useEffect(() => {
    setV(q.type === 'geo' ? null : '');
    setQStartTime(Date.now()); 
  }, [room.currentQuestionIndex, q.type]);
  
  const hasAnswered = player.currentAnswer !== null && player.currentAnswer !== undefined && player.currentAnswer !== "";
  const timeIsUp = q.timer > 0 && room.timeLeft === 0 && room.status === 'active';
  const isJokerActiveNow = player.jokerQuestion === room.currentQuestionIndex;
  
  const isLockedOut = (room.buzzerLockedOut || []).includes(player.id);

  const handleBuzzClick = () => {
    try {
        const audio = new Audio('/buzzer.mp3');
        audio.play().catch(e => console.log("Sound konnte nicht abgespielt werden:", e));
    } catch(err) {}
    const reactionTimeMs = Date.now() - qStartTime;
    onBuzz(reactionTimeMs);
  };

  if (room.status === 'lobby') return (
    <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700">
      <h2 className="text-2xl font-bold">Hallo {player.name}!</h2>
      {player.team && <div className="mt-4 text-lg font-bold text-sky-600 bg-sky-50 inline-block px-6 py-2 rounded-full border border-sky-100">Dein Team: {player.team}</div>}
      <p className="mt-8 animate-pulse text-[#E69F00]">Warte auf Start...</p>
    </div>
  );
  
  if (room.status === 'finished') {
    const myTeamId = player.team && player.team.trim() !== "" ? player.team.trim() : player.name;
    const myTeam = sortedTeams.find(t => t.name === myTeamId);
    const myRank = sortedTeams.findIndex(t => t.name === myTeamId) + 1;
    
    return (
      <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700 relative overflow-hidden">
        {myRank <= 3 && <Confetti />} 
        <Trophy size={64} className="mx-auto text-[#E69F00] mb-6 relative z-10"/>
        <h2 className="text-2xl font-bold mb-2 relative z-10">Quiz beendet!</h2>
        
        <div className="mt-6 mb-8 relative z-10">
            <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mb-2">Team-Punkte</p>
            <div className="text-6xl font-bold text-[#E69F00]">{myTeam?.totalScore || 0}</div>
        </div>

        <div className="text-xl font-bold text-emerald-500 bg-emerald-50 inline-block px-6 py-3 rounded-full border border-emerald-100 mb-6 relative z-10">Dein Team-Platz: {myRank}</div>
        
        <div className="border-t border-sky-50 pt-6 relative z-10">
            <p className="text-sm text-slate-400">Deine persönlichen Punkte</p>
            <p className="text-2xl font-bold text-slate-600">{player.score}</p>
        </div>
      </div>
    );
  }
  
  if (q.type === 'slide') {
    return (
      <div className="text-center py-10 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700 px-4">
        {q.showImg && q.imgUrl ? (
          <QuizImage src={q.imgUrl} className="w-full max-h-[65vh] object-contain rounded-xl bg-slate-50" placeholderClassName="h-48 flex items-center justify-center text-slate-300 animate-pulse" />
        ) : q.showImg && q.q ? (
          <div className="py-6">
            <h2 className="text-3xl font-bold mb-4 text-[#E69F00]">{q.q}</h2>
            {q.note && <p className="text-lg text-slate-600 whitespace-pre-line">{q.note}</p>}
          </div>
        ) : (
          <div className="py-10">
            <div className="text-6xl mb-6">👀</div>
            <h2 className="text-2xl font-bold mb-2 text-[#E69F00]">Schau nach vorne!</h2>
            <p className="text-slate-500">Gleich geht's weiter …</p>
          </div>
        )}
      </div>
    );
  }

  if (q.type === 'break') {
    const myTeamId = player.team && player.team.trim() !== "" ? player.team.trim() : player.name;
    const myTeam = sortedTeams.find(t => t.name === myTeamId);
    const myRank = sortedTeams.findIndex(t => t.name === myTeamId) + 1;
    
    return (
      <div className="text-center py-16 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700">
        <h2 className="text-3xl font-bold mb-6 text-[#E69F00]">⏸️ {q.q || 'Pause'}</h2>
        <p className="mb-8 text-lg font-medium text-slate-500 px-6">Zeit zum Durchatmen! Schau auf den Beamer für den aktuellen Zwischenstand.</p>
        
        <div className="bg-sky-50 py-6 px-4 mx-6 rounded-2xl border border-sky-100 mb-6">
            <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mb-1">Eure Team-Punkte</p>
            <div className="text-5xl font-bold text-[#E69F00]">{myTeam?.totalScore || 0}</div>
        </div>

        <div className="text-lg font-bold text-sky-600 bg-white inline-block px-6 py-2 rounded-full border border-sky-200">
            Aktueller Platz: {myRank}
        </div>
      </div>
    );
  }

  const renderJokerArea = () => {
      if (!room.allowJokers || room.status !== 'active') return null;

      if (player.jokerUsed) {
          if (isJokerActiveNow) {
              return (
                  <div className="mb-6">
                      <div className="bg-amber-100 text-amber-700 font-bold py-4 rounded-2xl text-center border-2 border-amber-400 animate-pulse shadow-inner">
                          🌟 JOKER IN DIESER RUNDE AKTIV! (Punkte x2)
                      </div>
                  </div>
              );
          } else {
              return (
                  <div className="mb-6">
                      <div className="bg-slate-100 text-slate-400 font-bold py-3 rounded-2xl text-center border border-slate-200 text-sm shadow-inner">
                          🃏 Joker wurde bereits gespielt.
                      </div>
                  </div>
              );
          }
      }

      if (!q.isJoker) {
          return (
              <div className="mb-6">
                  <div className="bg-slate-100 text-slate-400 font-bold py-3 rounded-2xl text-center border border-slate-200 text-sm shadow-inner">
                      ❌ Auf diese Frage kann kein Joker gesetzt werden.
                  </div>
              </div>
          );
      }

      return (
        <div className="mb-6">
            <button onClick={onUseJoker} className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-white font-bold py-4 rounded-2xl shadow-lg hover:scale-[1.02] transition-transform flex items-center justify-center gap-2">
                <Trophy size={24}/> JOKER FÜR DIESE RUNDE EINSETZEN
            </button>
        </div>
      );
  }

  let successText = 'Punkt für euch!';
  if (player.wasCorrect) {
      if (q.type === 'estimation' && player.isBullseye) {
          successText = isJokerActiveNow ? '🎯🌟 VOLLTREFFER! 4 Punkte für euch!' : '🎯 VOLLTREFFER! 2 Punkte für euch!';
      } else if ((q.type === 'text' || q.type === 'step' || q.type === 'geo') && player.currentAwardedPoints !== undefined) {
          successText = isJokerActiveNow ? `🌟 ${player.currentAwardedPoints} Punkte für euch!` : `${player.currentAwardedPoints} Punkt${player.currentAwardedPoints !== 1 ? 'e' : ''} für euch!`;
      } else {
          successText = isJokerActiveNow ? '🌟 2 Punkte für euch!' : 'Punkt für euch!';
      }
  }

  if (q.type === 'buzzer') {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center text-slate-700">
        <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
            <span>Frage {getQuestionNumber(room.questions, room.currentQuestionIndex)}</span>
            <span className="text-[#E69F00]">Persönliche Punkte: {player.score}</span>
        </div>
        
        {q.imgUrl && q.showImg && getMediaType(q.imgUrl) === 'image' && <QuizImage src={q.imgUrl} className="w-full h-40 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 mb-6"/>}
        {q.imgUrl && q.showImg && (getMediaType(q.imgUrl) === 'youtube' || getMediaType(q.imgUrl) === 'audio') && (
           <div className="w-full h-32 bg-slate-800 rounded-xl flex flex-col items-center justify-center text-sky-400 shadow-sm mb-6 border border-slate-700">
              <Play size={32} className="mb-2 opacity-50"/>
              <span className="text-sm font-bold uppercase tracking-widest">Achtung Beamer</span>
              <span className="text-xs text-slate-400 mt-1">Audio / Video läuft beim Quizmaster</span>
           </div>
        )}

        <h2 className="text-2xl font-bold mb-6">{q.q || 'Macht euch bereit...'}</h2>

        {renderJokerArea()}
        
        {room.status === 'active' && !room.buzzerWinner && isLockedOut && (
            <div className="w-64 h-64 rounded-full bg-slate-200 border-8 border-slate-300 shadow-inner mx-auto flex items-center justify-center mt-8 cursor-not-allowed">
                <span className="text-3xl font-black text-slate-400 uppercase tracking-widest">Gesperrt</span>
            </div>
        )}

        {room.status === 'active' && !room.buzzerWinner && !isLockedOut && (
            <button onClick={handleBuzzClick} className="w-64 h-64 rounded-full bg-red-600 border-8 border-red-800 shadow-[0_10px_0_#7f1d1d,0_0_50px_rgba(220,38,38,0.3)] active:translate-y-[10px] active:shadow-none transition-all mx-auto flex items-center justify-center mt-8">
                <span className="text-4xl font-black text-white">BUZZER</span>
            </button>
        )}
        
        {room.status === 'active' && room.buzzerWinner && room.buzzerWinner === player.id && <div className="py-12 bg-red-50 rounded-3xl border-2 border-red-500 animate-pulse text-3xl font-bold text-red-500 mt-8">DU BIST DRAN!</div>}
        
        {room.status === 'revealed' && typeof player.wasCorrect === 'boolean' && (
            <div className="mt-8 space-y-4">
                <div className={`py-10 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-50 border-emerald-500 text-emerald-500':'bg-red-50 border-red-500 text-red-500'}`}>
                    <h3 className="text-2xl font-bold">{player.wasCorrect ? successText : 'Leider kein Punkt.'}</h3>
                    {q.correctValue && (
                        <div className="mt-6">
                            <span className="text-xs uppercase font-bold tracking-widest opacity-70 block mb-2 text-slate-500">Richtige Lösung:</span>
                            <span className="text-2xl font-black bg-white px-6 py-3 rounded-xl shadow-sm border border-slate-200 inline-block text-slate-800">
                                {q.correctValue}
                            </span>
                        </div>
                    )}
                </div>

                {q.note && (
                    <div className="bg-blue-50 border border-blue-200 p-6 rounded-3xl text-left shadow-sm">
                        <span className="text-xs uppercase font-bold tracking-widest text-blue-500 block mb-2">💡 Schon gewusst?</span>
                        <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{q.note}</p>
                    </div>
                )}
            </div>
        )}
      </div>
    );
  }
  
  return (
    <div className="max-w-md mx-auto space-y-6 text-slate-700">
      <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest">
        <span>Frage {getQuestionNumber(room.questions, room.currentQuestionIndex)}</span>
        {q.isJoker && <span className="text-amber-500 font-black animate-pulse bg-amber-50 px-2 py-1 rounded">🌟 2 PUNKTE</span>}
        {q.timer === 0 && <span className="flex items-center gap-1 text-[#E69F00]"><Clock size={12}/> ∞</span>}
      </div>

      {q.timer > 0 && room.status === 'active' && !timeIsUp && (
        <div className="flex justify-center my-4">
           <div className={`flex items-center gap-3 px-8 py-3 rounded-full border-4 shadow-lg font-mono text-4xl font-bold transition-all duration-300 ${room.timeLeft <= 5 ? 'bg-red-50 border-red-500 text-red-600 animate-pulse scale-110' : 'bg-white border-sky-100 text-[#E69F00]'}`}>
              <Clock size={36}/> {room.timeLeft}s
           </div>
        </div>
      )}

      <h2 className="text-2xl font-bold leading-tight mb-2">{q.q}</h2>
      
      {q.imgUrl && q.showImg && getMediaType(q.imgUrl) === 'image' && <QuizImage src={q.imgUrl} className="w-full h-48 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 shadow-sm"/>}
      {q.imgUrl && q.showImg && (getMediaType(q.imgUrl) === 'youtube' || getMediaType(q.imgUrl) === 'audio') && (
         <div className="w-full h-32 bg-slate-800 rounded-xl flex flex-col items-center justify-center text-sky-400 shadow-sm mb-6 border border-slate-700">
            <Play size={32} className="mb-2 opacity-50"/>
            <span className="text-sm font-bold uppercase tracking-widest">Achtung Beamer</span>
            <span className="text-xs text-slate-400 mt-1">Audio / Video läuft beim Quizmaster</span>
         </div>
      )}

      {q.type === 'step' && room.status === 'active' && (
        <div className="space-y-3 mb-6">
            <h3 className="font-bold text-slate-500 uppercase tracking-widest text-xs">Aktuelle Hinweise:</h3>
            {q.steps && q.steps.slice(0, (room.currentStepIndex || 0) + 1).map((s, idx) => (
                <div key={idx} className="bg-sky-50 border border-sky-100 p-3 rounded-xl shadow-sm text-sm">
                    <span className="font-bold text-sky-600 mr-2">{idx + 1}.</span> {s.text}
                </div>
            ))}
        </div>
      )}

      {renderJokerArea()}
      
      {room.status === 'active' && !hasAnswered && !timeIsUp && (
        <div className="space-y-3 pt-2">
          {q.type === 'multiple' && q.options.map((o,i)=><button key={i} onClick={()=>onAnswer(i)} className="w-full bg-white p-5 rounded-2xl text-left border border-sky-100 shadow-sm font-medium active:bg-sky-50 active:scale-[0.98] transition-all">{o}</button>)}
          
          {(q.type === 'text' || q.type === 'estimation' || q.type === 'step') && (
              <div className="space-y-4">
                  <input type={q.type==='estimation'?'number':'text'} className="w-full bg-slate-50 p-5 rounded-2xl border border-sky-100 outline-none focus:border-[#E69F00]" value={v} onChange={e=>setV(e.target.value)} placeholder="Antwort..."/>
                  <button onClick={()=>onAnswer(v)} disabled={!v} className="w-full bg-[#E69F00] text-white py-4 rounded-2xl font-bold shadow-md disabled:opacity-50">
                      Abschicken
                  </button>
              </div>
          )}
          
          {/* NATIVE SPIELER MAP (Ohne Text, limitierter Zoom) */}
          {q.type === 'geo' && (
              <div className="space-y-4">
                  <div className="w-full rounded-2xl overflow-hidden border border-sky-200 z-0 relative shadow-sm" style={{ height: '350px' }}>
                      <MapErrorBoundary>
                          <GeoMap 
                              key={`player-${room.currentQuestionIndex}`}
                              lat={v?.lat} 
                              lng={v?.lng} 
                              isTarget={false} 
                              onMapClick={setV} 
                              hideLabels={true} 
                              mapStyle={q.mapStyle || 'comic'}
                              startView={q.startView || 'europe'}
                          />
                      </MapErrorBoundary>
                  </div>
                  <button onClick={()=>onAnswer(v)} disabled={!v || !v.lat} className="w-full bg-[#E69F00] text-white py-4 rounded-2xl font-bold shadow-md disabled:opacity-50">
                      Pin einloggen
                  </button>
              </div>
          )}
        </div>
      )}

      {room.status === 'active' && !hasAnswered && timeIsUp && (
        <div className="text-center py-12 bg-white rounded-3xl border border-sky-100 shadow-inner text-red-500 font-bold text-lg flex flex-col items-center gap-2">
           <Clock size={32}/> Zeit abgelaufen!
           <span className="text-sm text-slate-400 mt-2 font-normal">Warte auf Auflösung...</span>
        </div>
      )}
      
      {hasAnswered && room.status === 'active' && <div className="text-center py-12 bg-white rounded-3xl border border-sky-100 shadow-inner text-[#E69F00] font-bold text-lg flex flex-col items-center gap-2"><CheckCircle size={32}/> Antwort eingeloggt!</div>}
      
      {room.status === 'revealed' && (q.type === 'text' || q.type === 'step' || q.type === 'geo') && !player.corrected && (
          <div className="py-12 rounded-3xl border-2 text-center bg-slate-50 border-sky-100 text-slate-400 shadow-inner animate-pulse">
             <h3 className="text-xl font-bold">{q.type === 'geo' && room.geoStage === 'pins' ? '📍 Alle Tipps sind jetzt vorne zu sehen!' : 'Quizmaster wertet aus...'}</h3>
             <p className="text-sm mt-2">{q.type === 'geo' && room.geoStage === 'pins' ? 'Gleich wird das Ziel aufgelöst …' : 'Warte auf die Entscheidung.'}</p>
          </div>
      )}
      
      {room.status === 'revealed' && ((q.type !== 'text' && q.type !== 'step' && q.type !== 'geo') || player.corrected) && typeof player.wasCorrect === 'boolean' && (
         <div className="mt-8 space-y-4">
             <div className={`py-10 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-50 border-emerald-500 text-emerald-500':'bg-red-50 border-red-500 text-red-500'}`}>
                 <h3 className="text-2xl font-bold">{player.wasCorrect ? successText : 'Leider kein Punkt.'}</h3>
                 
                 {q.type === 'geo' && player.currentAnswer?.lat && (
                     <div className="mt-6">
                         <span className="text-xs uppercase font-bold tracking-widest opacity-70 block mb-2 text-slate-500">Dein Ergebnis:</span>
                         <span className="text-2xl font-black bg-white px-6 py-3 rounded-xl shadow-sm border border-slate-200 inline-block text-slate-800">
                             {calculateDistance(Number(q.targetLat) || 51.165, Number(q.targetLng) || 10.451, Number(player.currentAnswer.lat), Number(player.currentAnswer.lng)).toFixed(1)} km entfernt
                         </span>
                     </div>
                 )}

                 {q.type !== 'geo' && q.correctValue && (
                     <div className="mt-6">
                         <span className="text-xs uppercase font-bold tracking-widest opacity-70 block mb-2 text-slate-500">Richtige Lösung:</span>
                         <span className="text-2xl font-black bg-white px-6 py-3 rounded-xl shadow-sm border border-slate-200 inline-block text-slate-800">
                             {q.type === 'multiple' ? q.options[q.correctIndex] : q.correctValue}
                         </span>
                     </div>
                 )}
             </div>

             {q.note && (
                 <div className="bg-blue-50 border border-blue-200 p-6 rounded-3xl text-left shadow-sm">
                     <span className="text-xs uppercase font-bold tracking-widest text-blue-500 block mb-2">💡 Schon gewusst?</span>
                     <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{q.note}</p>
                 </div>
             )}
         </div>
      )}
    </div>
  );
}

function ObserverDashboard({ room, players }) {
  const q = room.questions[room.currentQuestionIndex];
  const sortedTeams = getSortedTeams(players, room);

  if (room.status === 'lobby') return (
    <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700">
      <h2 className="text-2xl font-bold">👀 Zuschauer-Modus</h2>
      <p className="mt-8 animate-pulse text-[#E69F00]">Warte auf Start...</p>
    </div>
  );

  if (room.status === 'finished') {
    return (
      <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700 relative overflow-hidden">
        <Confetti />
        <Trophy size={64} className="mx-auto text-[#E69F00] mb-6 relative z-10"/>
        <h2 className="text-2xl font-bold mb-6 relative z-10">Quiz beendet!</h2>
        
        <div className="mt-6 space-y-4 relative z-10 px-4">
            <h3 className="font-bold text-slate-400 uppercase tracking-widest text-sm mb-2">Top 3 Teams</h3>
            {sortedTeams.slice(0, 3).map((t, i) => (
                <div key={t.name} className={`flex justify-between items-center p-3 rounded-xl border ${i===0 ? 'bg-yellow-50 border-[#E69F00]' : 'bg-slate-50 border-sky-50'}`}>
                    <span className="font-bold">{i+1}. {t.name}</span>
                    <span className="text-[#E69F00] font-bold">{t.totalScore} Pkt</span>
                </div>
            ))}
        </div>
      </div>
    );
  }

  if (q.type === 'slide') {
    return (
      <div className="text-center py-10 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700 px-4">
        {q.imgUrl ? (
          <QuizImage src={q.imgUrl} className="w-full max-h-[65vh] object-contain rounded-xl bg-slate-50" placeholderClassName="h-48 flex items-center justify-center text-slate-300 animate-pulse" />
        ) : (
          <div className="py-6">
            <h2 className="text-3xl font-bold mb-4 text-[#E69F00]">{q.q}</h2>
            {q.note && <p className="text-lg text-slate-600 whitespace-pre-line">{q.note}</p>}
          </div>
        )}
      </div>
    );
  }

  if (q.type === 'break') {
    return (
      <div className="text-center py-16 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700">
        <h2 className="text-3xl font-bold mb-6 text-[#E69F00]">⏸️ {q.q || 'Pause'}</h2>
        <p className="mb-8 text-lg font-medium text-slate-500 px-6">Zeit zum Durchatmen!</p>
        <div className="space-y-3 px-6 text-left">
            <h3 className="font-bold text-slate-400 uppercase tracking-widest text-sm mb-2 text-center">Aktuelle Top 3</h3>
            {sortedTeams.slice(0, 3).map((t, i) => (
                <div key={t.name} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-sky-50">
                    <span className="font-bold text-slate-600">{i+1}. {t.name}</span>
                    <span className="text-[#E69F00] font-bold">{t.totalScore} Pkt</span>
                </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6 text-slate-700">
      <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest">
        <span>Frage {getQuestionNumber(room.questions, room.currentQuestionIndex)}</span>
        {q.isJoker && <span className="text-amber-500 font-black animate-pulse bg-amber-50 px-2 py-1 rounded">🌟 JOKER-FRAGE</span>}
        {q.timer === 0 && <span className="flex items-center gap-1 text-[#E69F00]"><Clock size={12}/> ∞</span>}
      </div>

      {q.timer > 0 && room.status === 'active' && (
        <div className="flex justify-center my-4">
           <div className={`flex items-center gap-3 px-8 py-3 rounded-full border-4 shadow-lg font-mono text-4xl font-bold transition-all duration-300 ${room.timeLeft <= 5 ? 'bg-red-50 border-red-500 text-red-600 animate-pulse scale-110' : 'bg-white border-sky-100 text-[#E69F00]'}`}>
              <Clock size={36}/> {room.timeLeft}s
           </div>
        </div>
      )}

      <h2 className="text-2xl font-bold leading-tight mb-2">{q.q || (q.type === 'buzzer' ? 'Buzzer-Runde' : '')}</h2>

      {q.imgUrl && q.showImg && getMediaType(q.imgUrl) === 'image' && <QuizImage src={q.imgUrl} className="w-full h-48 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 shadow-sm"/>}
      {q.imgUrl && q.showImg && (getMediaType(q.imgUrl) === 'youtube' || getMediaType(q.imgUrl) === 'audio') && (
         <div className="w-full h-32 bg-slate-800 rounded-xl flex flex-col items-center justify-center text-sky-400 shadow-sm mb-6 border border-slate-700">
            <Play size={32} className="mb-2 opacity-50"/>
            <span className="text-sm font-bold uppercase tracking-widest">Achtung Beamer</span>
            <span className="text-xs text-slate-400 mt-1">Audio / Video läuft beim Quizmaster</span>
         </div>
      )}

      {q.type === 'step' && room.status === 'active' && (
        <div className="space-y-3 mb-6">
            <h3 className="font-bold text-slate-500 uppercase tracking-widest text-xs">Aktuelle Hinweise:</h3>
            {q.steps && q.steps.slice(0, (room.currentStepIndex || 0) + 1).map((s, idx) => (
                <div key={idx} className="bg-sky-50 border border-sky-100 p-3 rounded-xl shadow-sm text-sm">
                    <span className="font-bold text-sky-600 mr-2">{idx + 1}.</span> {s.text}
                </div>
            ))}
        </div>
      )}

      {room.status === 'active' && (
        <div className="text-center py-10 bg-white rounded-3xl border border-sky-100 shadow-inner mt-4">
           <span className="text-2xl mb-2 block">👀</span>
           <h3 className="font-bold text-sky-600 mb-1">Zuschauer-Modus</h3>
           <p className="text-sm text-slate-400 px-4">Dein Team-Captain loggt die Antworten ein. Besprecht euch!</p>
           {q.type === 'multiple' && (
               <div className="mt-6 space-y-2 px-4">
                   {q.options.map((o,i)=><div key={i} className="w-full bg-slate-50 p-3 rounded-xl text-left border border-sky-50 text-sm text-slate-500 font-medium">{o}</div>)}
               </div>
           )}
        </div>
      )}

      {room.status === 'revealed' && (
         <div className="mt-8 space-y-4">
             <div className="py-10 rounded-3xl border-2 text-center bg-slate-50 border-sky-100 text-slate-700">
                 <h3 className="text-lg font-bold text-slate-400 uppercase tracking-widest mb-4">Auflösung</h3>
                 <span className="text-2xl font-black bg-white px-6 py-3 rounded-xl shadow-sm border border-slate-200 inline-block text-slate-800">
                     {q.type === 'multiple' ? q.options[q.correctIndex] : (q.correctValue || "Quizmaster entscheidet")}
                 </span>
             </div>

             {q.note && (
                 <div className="bg-blue-50 border border-blue-200 p-6 rounded-3xl text-left shadow-sm">
                     <span className="text-xs uppercase font-bold tracking-widest text-blue-500 block mb-2">💡 Schon gewusst?</span>
                     <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{q.note}</p>
                 </div>
             )}
         </div>
      )}
    </div>
  );
}