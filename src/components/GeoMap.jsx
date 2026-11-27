import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// --- ABSOLUT SICHERE CSS-ICONS ---
export const getPinIcon = (isTarget = false, opts = {}) => {
    if (typeof window === 'undefined') return null;
    if (!isTarget && opts.emoji) {
        // Spieler-Pin: Team-Tier im Kreis in Teamfarbe (Gewinner mit goldenem Ring)
        const size = opts.winner ? 40 : 32;
        const ring = opts.winner ? '#FACC15' : 'white';
        return L.divIcon({
            className: 'custom-css-pin',
            html: `<div class="${opts.drop ? 'geo-pin-drop' : ''}" style="background-color: ${opts.color || '#D4A12A'}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${opts.winner ? 4 : 3}px solid ${ring}; box-shadow: 0 4px 8px rgba(0,0,0,0.45); position: relative; top: -${size / 2}px; left: -${size / 2}px; display: flex; align-items: center; justify-content: center; font-size: ${Math.round(size * 0.55)}px; line-height: 1;">${opts.emoji}</div>`,
            iconSize: [0, 0]
        });
    }
    const size = isTarget || opts.winner ? 30 : 24;
    const color = isTarget ? '#DC2626' : (opts.winner ? '#FACC15' : (opts.color || '#D4A12A'));
    return L.divIcon({
        className: 'custom-css-pin',
        html: `<div class="${opts.drop ? 'geo-pin-drop' : ''}" style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.4); position: relative; top: -${size / 2}px; left: -${size / 2}px;"></div>`,
        iconSize: [0, 0]
    });
};

export const GEO_CSS = `
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

export const formatKm = (d) => (d == null || isNaN(d)) ? '' : `${d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString('de-DE')} km`;

// --- KARTENSTILE & STARTAUSSCHNITTE FÜR DAS GEO-QUIZ ---
// Beide Stile sind kostenlos, ohne API-Schlüssel und zeigen keine Ländergrenzen, Städte oder Beschriftungen.
export const MAP_STYLES = {
    comic: { label: '🎮 Comic (wie Schlag den Star)' },
    satellite: { label: '🛰️ Satellit mit Vegetation (NASA)' },
};

export const MAP_VIEWS = {
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
export const LAND_GEOJSON_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';

export let landPromise = null;

export const loadLandGeoJSON = () => {
    if (!landPromise) {
        landPromise = fetch(LAND_GEOJSON_URL)
            .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .catch(err => { landPromise = null; throw err; });
    }
    return landPromise;
};

// Wechselt die Hintergrundkarte: 'comic', 'satellite' oder 'real' (echte Karte mit Beschriftung).
// Mit fade=true wird die echte Karte weich über die bisherige geblendet.
export const setBaseLayer = (map, mapDom, style, groupRef, fade = false) => {
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
export const GeoMap = ({ lat, lng, onMapClick, isTarget = false, playerPins = [], readOnly = false, hideLabels = false, mapStyle = 'comic', startView = 'europe', stage = null }) => {
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
    const pinsKey = JSON.stringify((playerPins || []).map(p => [p.id, p.name, p.lat, p.lng, p.emoji, p.color]));
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
            const m = L.marker([p.lat, p.lng], { icon: getPinIcon(false, { drop: stage === 'pins', emoji: p.emoji, color: p.color }) })
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
                const l = L.polyline([[lat, lng], [p.lat, p.lng]], { color: '#D4A12A', weight: 3, dashArray: '6, 10', className: 'geo-line' }).addTo(map);
                playerElementsRef.current.lines.push(l);
                m.setTooltipContent(`${p.name} · ${formatKm(p.dist)}`);
            }, startAt + i * step);
        });

        later(() => {
            entries.filter(e => e.p.dist === minDist).forEach(({ p, m }) => {
                m.setIcon(getPinIcon(false, { winner: true, drop: animate, emoji: p.emoji, color: p.color }));
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
export class MapErrorBoundary extends React.Component {
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
