import React, { useEffect, useRef, useState } from 'react';
import { ImageIcon, Upload, X } from 'lucide-react';
import { ZOOM_DEFAULT_SECONDS, fmtPts, getZoomScale, isPlaceRevealed } from '../lib/helpers';
import { getImageFromClipboard, isFsImage, uploadQuizImage, useResolvedImage } from '../lib/images';
import { QUESTION_TYPES } from '../lib/questionTypes';

// --- HELFER: KONFETTI ANIMATION ---
export const Confetti = () => {
  const [particles] = useState(() => Array.from({ length: 120 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    animationDelay: Math.random() * 3,
    color: ['#D4A12A', '#10B981', '#3B82F6', '#EF4444', '#F472B6', '#A855F7'][Math.floor(Math.random() * 6)],
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

export const QuizImage = ({ src, className = '', placeholderClassName, alt = '' }) => {
  const resolved = useResolvedImage(src);
  if (!resolved) {
    return <div className={placeholderClassName || `${className} flex items-center justify-center text-slate-300 text-sm animate-pulse`}>Bild lädt …</div>;
  }
  return <img src={resolved} className={className} alt={alt} />;
};

// Bildfeld für den Editor: Link eintippen, Bild mit Strg+V einfügen, hineinziehen oder hochladen.
export function ImageInput({ value, onChange, variant = 'compact' }) {
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
      <div {...dragProps} className={`w-full rounded-2xl border-2 border-dashed p-4 transition-colors ${dragOver ? 'border-[#14284B] bg-[#F0E3C8]' : 'border-[#DCC7A0] bg-[#FFFBF3]'}`}>
        {fileInput}
        {busy ? (
          <div className="h-48 flex items-center justify-center text-[#14284B] font-bold animate-pulse">Bild wird verkleinert & gespeichert …</div>
        ) : value ? (
          <div className="relative">
            <QuizImage src={value} className="w-full max-h-[360px] object-contain rounded-xl bg-slate-900" placeholderClassName="h-48 flex items-center justify-center text-slate-300 animate-pulse" />
            <button onClick={() => onChange('')} className="absolute top-2 right-2 bg-[#FFFBF3]/90 hover:bg-red-500 hover:text-white text-red-500 p-2 rounded-lg shadow transition-colors" title="Bild entfernen"><X size={18}/></button>
          </div>
        ) : (
          <div className="h-32 flex flex-col items-center justify-center text-slate-400 text-sm gap-1">
            <ImageIcon size={32} className="text-[#C9B88F]"/>
            <span>Noch kein Bild – Folie aus PowerPoint kopieren und unten einfügen</span>
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <input value="" onChange={() => {}} onPaste={onPaste} disabled={busy}
            placeholder={value ? 'Zum Ersetzen hier klicken und Strg+V (Mac: ⌘+V) drücken …' : 'Hier klicken und Strg+V (Mac: ⌘+V) drücken – oder Bild hierher ziehen'}
            className="flex-1 bg-[#F8EFDF] p-3 rounded-xl border border-[#E6D6B8] text-sm outline-none focus:border-[#B98A1C] focus:bg-[#FFFBF3] cursor-pointer" />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="bg-[#FFFBF3] px-4 rounded-xl border border-[#DCC7A0] text-[#14284B] font-semibold text-sm hover:bg-[#F8EFDF] transition-colors flex items-center gap-2"><Upload size={16}/> Datei</button>
        </div>
      </div>
    );
  }

  return (
    <div {...dragProps} className={`flex-1 min-w-[200px] flex items-center gap-2 rounded ${dragOver ? 'ring-2 ring-[#D4A12A]' : ''}`}>
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
          className="flex-1 bg-slate-50 p-2 rounded border border-[#EFE3CC] text-xs"
          value={value || ''} onChange={e => onChange(e.target.value)} />
      )}
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="p-2 bg-[#FFFBF3] border border-[#E6D6B8] rounded text-[#14284B] hover:bg-[#F8EFDF]" title="Bild vom Computer hochladen"><ImageIcon size={16}/></button>
    </div>
  );
}

// Reine Text-Folie (wenn kein Bild eingefügt ist)
export const TextSlide = ({ q, kicker }) => (
  <div className="w-full h-full bg-gradient-to-br from-[#14284B] to-indigo-900 flex flex-col items-center justify-center text-center p-16 text-white">
    <style>{`@keyframes qkRise { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }`}</style>
    {kicker && <div className="text-2xl lg:text-4xl font-black tracking-[0.4em] text-[#FFD166] mb-8" style={{ animation: 'qkRise .7s ease-out both' }}>{kicker}</div>}
    <h2 className="text-6xl lg:text-8xl font-black mb-10 leading-tight" style={{ animation: 'qkRise .8s ease-out .15s both' }}>{q.q}</h2>
    {q.note && <p className="text-3xl lg:text-4xl font-medium whitespace-pre-line max-w-5xl opacity-90 leading-relaxed" style={{ animation: 'qkRise .8s ease-out .35s both' }}>{q.note}</p>}
  </div>
);

export const AnimatedNumber = ({ from = 0, to = 0, start = true, duration = 1300 }) => {
  const [val, setVal] = useState(from);
  useEffect(() => {
    if (!start) { setVal(from); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      setVal(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, start]);
  return <>{fmtPts(val)}</>;
};

// --- ZWISCHENSTAND: Balken sortieren sich live neu ---
export const AnimatedRanking = ({ teams, previous = [] }) => {
  const [moved, setMoved] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMoved(true), 900); return () => clearTimeout(t); }, []);
  const prev = {};
  (previous || []).forEach(x => { prev[x.name] = x.score; });
  const ROW = 78;
  const before = [...teams].sort((a, b) => (prev[b.name] || 0) - (prev[a.name] || 0) || a.name.localeCompare(b.name));
  const maxScore = Math.max(1, ...teams.map(t => t.totalScore));
  return (
    <div className="relative" style={{ height: teams.length * ROW }}>
      {teams.map((t, afterIdx) => {
        const idx = moved ? afterIdx : before.findIndex(x => x.name === t.name);
        const old = prev[t.name] || 0;
        const delta = t.totalScore - old;
        const pct = Math.max(2, ((moved ? t.totalScore : old) / maxScore) * 100);
        const lead = moved && afterIdx === 0;
        return (
          <div key={t.name} className="absolute left-0 right-0 transition-all duration-1000 ease-in-out" style={{ top: idx * ROW, height: ROW - 12 }}>
            <div className={`relative h-full rounded-2xl border-2 overflow-hidden bg-[#FFFBF3] ${lead ? 'shadow-lg' : ''}`} style={{ borderColor: t.style ? `${t.style.color}${lead ? '' : '55'}` : undefined }}>
              <div className="absolute inset-y-0 left-0 transition-all ease-out" style={{ width: `${pct}%`, transitionDuration: '1400ms', backgroundColor: t.style ? `${t.style.color}${lead ? '55' : '30'}` : '#E0F2FE' }} />
              <div className="relative h-full flex items-center justify-between px-5 gap-4">
                <span className="text-2xl font-bold text-[#14284B] flex items-center gap-3 min-w-0">
                  <span className="w-10 text-slate-400 flex-shrink-0">{idx + 1}.</span>
                  <TeamAvatar style={t.style} size="md" />
                  <span className="truncate">{lead && '👑 '}{t.name}</span>
                </span>
                <span className="flex items-center gap-3 flex-shrink-0">
                  {moved && delta > 0 && <span className="text-emerald-600 font-bold text-lg bg-emerald-50 px-2 py-0.5 rounded-lg">+{fmtPts(delta)}</span>}
                  <span className="font-mono text-3xl font-bold text-[#D4A12A] w-20 text-right"><AnimatedNumber from={old} to={t.totalScore} start={moved} /></span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const Podium = ({ teams, step }) => {
  const order = [2, 1, 3].filter(pl => pl <= teams.length);
  const style = {
    1: { h: 'h-64', bg: 'bg-gradient-to-b from-amber-300 to-amber-500', medal: '🥇' },
    2: { h: 'h-48', bg: 'bg-gradient-to-b from-slate-300 to-slate-400', medal: '🥈' },
    3: { h: 'h-36', bg: 'bg-gradient-to-b from-orange-300 to-orange-500', medal: '🥉' },
  };
  return (
    <div className="flex items-end justify-center gap-4 md:gap-8">
      {order.map(place => {
        const t = teams[place - 1];
        const shown = isPlaceRevealed(place, teams.length, step);
        const st = style[place];
        return (
          <div key={place} className="flex flex-col items-center w-40 md:w-60">
            <div className={`mb-4 text-center transition-all duration-700 ${shown ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-75'}`}>
              <div className="relative inline-block mb-3">
                {t.style ? <TeamAvatar style={t.style} size="xl" /> : <span className="text-6xl">{st.medal}</span>}
                {t.style && <span className="absolute -top-3 -right-3 text-5xl">{st.medal}</span>}
              </div>
              <div className="text-2xl md:text-3xl font-black text-[#14284B] break-words">{t.name}</div>
              <div className="font-mono text-3xl font-bold text-[#D4A12A]">{fmtPts(t.totalScore)}</div>
              <div className="text-xs text-slate-400 mt-1">{t.players.map(pp => pp.name).join(', ')}</div>
            </div>
            <div className={`w-full ${st.h} ${st.bg} rounded-t-3xl flex items-start justify-center pt-4 text-7xl font-black text-white shadow-xl`}>
              {shown ? place : '?'}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Kleine Bausteine für den Editor
export const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 cursor-pointer select-none py-1">
    <span className={`mt-0.5 relative inline-flex w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-emerald-500' : 'bg-slate-200'}`}>
      <input type="checkbox" className="sr-only" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-[#FFFBF3] rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </span>
    <span>
      <span className="text-sm font-semibold text-[#14284B] block">{label}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </span>
  </label>
);

export const FieldLabel = ({ children }) => <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">{children}</label>;

export const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
    <div className={`bg-[#FFFBF3] rounded-3xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center px-6 py-4 border-b border-[#EFE3CC] sticky top-0 bg-[#FFFBF3] rounded-t-3xl">
        <h3 className="text-xl font-bold text-[#14284B]">{title}</h3>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-[#14284B] rounded-lg hover:bg-slate-50"><X size={20}/></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

export const TypePicker = ({ title, onPick, onClose, currentType }) => (
  <Modal title={title} onClose={onClose} wide>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {QUESTION_TYPES.map(t => (
        <button key={t.type} onClick={() => onPick(t.type)}
          className={`text-left p-4 rounded-2xl border-2 transition-all hover:-translate-y-0.5 hover:shadow-md ${t.type === currentType ? 'border-[#D4A12A] bg-amber-50' : 'border-[#E6D6B8] bg-[#FFFBF3] hover:border-[#C9A96A]'}`}>
          <div className="text-3xl mb-2">{t.icon}</div>
          <div className="font-bold text-[#14284B] text-sm">{t.label}</div>
          <div className="text-xs text-slate-400 mt-1 leading-snug">{t.desc}</div>
        </button>
      ))}
    </div>
  </Modal>
);

// --- BILD-ZOOM: Ausschnitt wird langsam größer ---
export const useZoomProgress = (room, q) => {
  const [local, setLocal] = useState(0);
  const noTimer = !(q?.timer > 0);
  useEffect(() => {
    if (q?.type !== 'zoom' || !noTimer || room.status !== 'active') return;
    setLocal(0);
    const t0 = Date.now();
    const id = setInterval(() => setLocal(Math.min(1, (Date.now() - t0) / (ZOOM_DEFAULT_SECONDS * 1000))), 1000);
    return () => clearInterval(id);
  }, [room.currentQuestionIndex, room.status, q?.type, noTimer]);
  if (q?.type !== 'zoom') return 0;
  return noTimer ? local : 1 - (room.timeLeft || 0) / q.timer;
};

export const ZoomImage = ({ q, progress = 0, revealed = false, maxH = '55vh', showBadge = true }) => {
  const src = useResolvedImage(q.imgUrl);
  const scale = getZoomScale(q, progress, revealed);
  return (
    <div className="flex justify-center">
      <div className="relative overflow-hidden rounded-2xl inline-block bg-slate-900 shadow-lg max-w-full">
        {src ? (
          <img src={src} alt="" className="block max-w-full select-none" draggable={false}
            style={{ maxHeight: maxH, transform: `scale(${scale})`, transformOrigin: `${q.zoomX ?? 50}% ${q.zoomY ?? 50}%`, transition: revealed ? 'transform 1.6s cubic-bezier(.2,.8,.2,1)' : 'transform 1.05s linear' }} />
        ) : (
          <div className="w-80 h-48 flex items-center justify-center text-slate-500 animate-pulse">Bild lädt …</div>
        )}
        {showBadge && src && !revealed && <div className="absolute top-3 left-3 bg-black/60 text-white text-sm font-bold px-3 py-1 rounded-full">🔍 {scale.toFixed(1)}×</div>}
      </div>
    </div>
  );
};

// Im Editor: Klick ins Bild setzt den Punkt, auf den gezoomt wird
export const ZoomFocusPicker = ({ q, onChange }) => {
  const src = useResolvedImage(q.imgUrl);
  if (!q.imgUrl) return null;
  const onClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange({ zoomX: Math.round(((e.clientX - r.left) / r.width) * 100), zoomY: Math.round(((e.clientY - r.top) / r.height) * 100) });
  };
  return (
    <div className="grid md:grid-cols-2 gap-4 items-start">
      <div>
        <p className="text-xs text-slate-500 mb-2">Klicke auf die Stelle, mit der der Zoom startet:</p>
        <div className="relative inline-block cursor-crosshair rounded-xl overflow-hidden border border-[#E6D6B8]" onClick={onClick}>
          {src ? <img src={src} alt="" className="block max-h-64 max-w-full" draggable={false} /> : <div className="w-64 h-40 bg-slate-100 animate-pulse" />}
          <div className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-4 border-white bg-red-500/80 shadow-lg pointer-events-none" style={{ left: `${q.zoomX ?? 50}%`, top: `${q.zoomY ?? 50}%` }} />
        </div>
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-2">So startet das Bild:</p>
        <ZoomImage q={q} progress={0} maxH="16rem" />
      </div>
    </div>
  );
};

// --- VERKLEINERTE BÜHNE: zeigt eine große Ansicht (z.B. Beamer) maßstabsgetreu im Kleinen ---
export const ScaledStage = ({ width = 1600, height = 900, children, className = '', interactive = false }) => {
  const ref = useRef(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => { if (el.clientWidth) setScale(el.clientWidth / width); };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, [width]);
  return (
    <div ref={ref} className={`relative w-full overflow-hidden ${className}`} style={{ height: height * scale }}>
      {/* transform macht diesen Kasten zum Rahmen für "fixed"-Elemente (z.B. Vollbild-Folien) */}
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0, pointerEvents: interactive ? 'auto' : 'none' }}>
        {children}
      </div>
    </div>
  );
};

// --- TEAM-AVATAR: Tier im farbigen Kreis ---
const AVATAR_SIZES = {
  xs: 'w-6 h-6 text-sm border-2',
  sm: 'w-8 h-8 text-lg border-2',
  md: 'w-11 h-11 text-2xl border-[3px]',
  lg: 'w-16 h-16 text-4xl border-4',
  xl: 'w-28 h-28 text-6xl border-[6px]',
};
export const TeamAvatar = ({ style, size = 'md', className = '' }) => {
  if (!style) return null;
  return (
    <span className={`inline-flex items-center justify-center rounded-full flex-shrink-0 shadow-sm leading-none ${AVATAR_SIZES[size] || AVATAR_SIZES.md} ${className}`}
      style={{ backgroundColor: `${style.color}22`, borderColor: style.color }}>
      {style.emoji}
    </span>
  );
};

// --- RETTUNGSRING-TIMER: rot-weißer Ring, außen leert sich ein goldener Bogen ---
export const LifeRingTimer = ({ timeLeft = 0, total = 0, paused = false, size = 120, dark = false }) => {
  const frac = total > 0 ? Math.max(0, Math.min(1, timeLeft / total)) : 1;
  const c = 2 * Math.PI * 54;
  const ring = 2 * Math.PI * 38;
  const urgent = total > 0 && timeLeft <= 5 && timeLeft > 0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`Timer: noch ${timeLeft} Sekunden`} className={urgent && !paused ? 'animate-pulse' : ''}>
      <circle cx="60" cy="60" r="54" fill="none" stroke={dark ? 'rgba(244,233,212,0.18)' : 'rgba(20,40,75,0.12)'} strokeWidth="6" />
      <circle cx="60" cy="60" r="54" fill="none" stroke={urgent ? '#D93A2B' : '#D4A12A'} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 1s linear' }} />
      <circle cx="60" cy="60" r="38" fill="none" stroke="#D93A2B" strokeWidth="18" />
      <circle cx="60" cy="60" r="38" fill="none" stroke="#FFFFFF" strokeWidth="18" strokeDasharray={`${ring / 8} ${ring / 8}`} transform="rotate(-22 60 60)" />
      <circle cx="60" cy="60" r="29" fill={dark ? '#14284B' : '#FFFBF3'} />
      {paused
        ? <g fill={dark ? '#F4E9D4' : '#14284B'}><rect x="51" y="48" width="6" height="24" rx="2" /><rect x="63" y="48" width="6" height="24" rx="2" /></g>
        : <text x="60" y="69" textAnchor="middle" fontFamily="DM Serif Display, serif" fontSize={timeLeft >= 100 ? 22 : 28} fill={dark ? '#F4E9D4' : '#14284B'}>{total > 0 ? timeLeft : '∞'}</text>}
    </svg>
  );
};

// --- ZWISCHENSTAND ALS REGATTA: Team-Boote segeln zum Leuchtturm ---
const Boat = ({ color }) => (
  <svg width="96" height="76" viewBox="0 0 120 94" aria-hidden="true">
    <path d="M58 6 L58 62 L18 62 Z" fill="#FFFFFF" />
    <path d="M64 14 L64 62 L98 62 Z" fill={color} />
    <rect x="58" y="4" width="5" height="60" fill="#14284B" />
    <path d="M8 64 L112 64 L98 86 L22 86 Z" fill="#14284B" />
    <path d="M0 90 Q 15 82 30 90 T 60 90 T 90 90 T 120 90" fill="none" stroke="#FFFFFF" strokeWidth="3" opacity="0.7" />
  </svg>
);

export const RegattaRanking = ({ teams, previous = [] }) => {
  const [moved, setMoved] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMoved(true), 900); return () => clearTimeout(t); }, []);
  const prev = {};
  (previous || []).forEach(x => { prev[x.name] = x.score; });
  const maxScore = Math.max(1, ...teams.map(t => t.totalScore));
  const lane = teams.length > 8 ? 64 : teams.length > 5 ? 84 : 104;
  return (
    <div className="relative rounded-3xl overflow-hidden border-4 border-[#14284B]">
      {teams.map((t, i) => {
        const old = prev[t.name] || 0;
        const delta = t.totalScore - old;
        const pos = ((moved ? t.totalScore : old) / maxScore) * 100;
        return (
          <div key={t.name} className="flex items-stretch" style={{ height: lane, background: i % 2 ? '#4A90C8' : '#3F86C2', borderBottom: '2px dashed rgba(255,255,255,0.35)' }}>
            <div className="flex items-center gap-3 px-4 flex-shrink-0" style={{ width: 300, background: '#14284B', color: '#F4E9D4' }}>
              <span className="font-mono text-2xl w-8" style={{ color: '#D4A12A' }}>{i + 1}.</span>
              <TeamAvatar style={t.style} size={lane < 80 ? 'sm' : 'md'} />
              <span className="min-w-0">
                <b className="block text-lg leading-tight truncate">{t.name}</b>
                <span className="text-sm font-bold" style={{ color: '#D4A12A' }}><AnimatedNumber from={old} to={t.totalScore} start={moved} /> Punkte</span>
                {moved && delta > 0 && <span className="text-xs font-black ml-2" style={{ color: '#7DD3A0' }}>+{fmtPts(delta)}</span>}
              </span>
            </div>
            <div className="relative flex-1" style={{ marginRight: 90 }}>
              <div className="absolute top-1/2 transition-all ease-out" style={{ left: `calc(${pos}% - ${pos / 100 * 96}px)`, transform: `translateY(-55%) scale(${lane < 80 ? 0.7 : 1})`, transitionDuration: '1600ms' }}>
                <Boat color={t.style ? t.style.color : '#D4A12A'} />
              </div>
            </div>
          </div>
        );
      })}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col items-center justify-end pb-3" style={{ width: 90, background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 12px, rgba(20,40,75,0.18) 12px 24px)' }}>
        <svg width="54" height="128" viewBox="0 0 76 180" aria-hidden="true">
          <path d="M24 40 L52 40 L60 170 L16 170 Z" fill="#FFFFFF" />
          <path d="M22 70 L54 70 L56 92 L20 92 Z M19 120 L57 120 L59 142 L17 142 Z" fill="#D93A2B" />
          <rect x="20" y="24" width="36" height="18" fill="#14284B" />
          <path d="M16 24 L38 6 L60 24 Z" fill="#D93A2B" />
          <circle cx="38" cy="33" r="5" fill="#D4A12A" />
        </svg>
        <span className="text-[11px] font-black tracking-widest text-white bg-[#14284B] px-2 py-1 rounded mt-1">ZIEL</span>
      </div>
    </div>
  );
};
