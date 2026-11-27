import React, { useEffect, useRef, useState } from 'react';
import { QuizImage } from './ui';
import { getRoundNumber } from '../lib/helpers';

// --- FOLIEN-BAUKASTEN: Vorlagen im Quizkopp-Look ---
// Jede Folie wird für 1600 × 900 gestaltet und überall maßstabsgetreu eingepasst
// (Beamer, Moderatoren-Ansicht, Editor-Vorschau, Handys).

export const SLIDE_W = 1600;
export const SLIDE_H = 900;

export const SLIDE_LAYOUTS = [
  { key: 'title',     icon: '🎤', label: 'Titel / Intro',     desc: 'Große Überschrift, Untertitel, Kapitän' },
  { key: 'rules',     icon: '⚓', label: 'Regeln & Infos',    desc: 'Bis zu 10 Punkte, auf Wunsch einzeln aufdecken' },
  { key: 'imageText', icon: '🖼️', label: 'Bild + Text',       desc: 'Bild links, Überschrift und Text rechts' },
  { key: 'quote',     icon: '💬', label: 'Fun Fact / Zitat',  desc: 'Ein großer Satz in Gold' },
  { key: 'pause',     icon: '☕', label: 'Pause',             desc: 'Mit großem Countdown' },
  { key: 'image',     icon: '📎', label: 'Eigenes Bild',      desc: 'z.B. eine Folie aus PowerPoint' },
];

export const SLIDE_THEMES = {
  navy:  { label: 'Navy',  bg: '#14284B', text: '#F4E9D4', title: '#D4A12A', accent: '#D4A12A', sub: '#C9D3E3', wave1: '#2B5A94', wave2: '#4A90C8', pill: 'rgba(244,233,212,0.12)' },
  cream: { label: 'Creme', bg: '#F4E9D4', text: '#14284B', title: '#14284B', accent: '#8A3B12', sub: '#5B6B85', wave1: '#C9B88F', wave2: '#14284B', pill: '#14284B' },
  sea:   { label: 'Meer',  bg: '#2F6FA8', text: '#FFFFFF', title: '#FFFFFF', accent: '#FFD166', sub: '#E0EEF9', wave1: '#4A90C8', wave2: '#14284B', pill: 'rgba(20,40,75,0.35)' },
};

export const getSlideLayout = (q) => {
  if (!q) return 'title';
  if (q.type === 'round') return q.imgUrl ? 'image' : 'round'; // ältere Runden mit eigenem Bild bleiben so
  return q.slideLayout || (q.imgUrl ? 'image' : 'title');
};
export const getSlideBullets = (q) => (q?.slideBullets || []).map(s => (s || '').trim()).filter(Boolean);
export const usesBulletReveal = (q) => getSlideLayout(q) === 'rules' && !!q.revealBullets && getSlideBullets(q).length > 0;
export const getLayoutInfo = (key) => SLIDE_LAYOUTS.find(l => l.key === key) || { key, icon: '🎬', label: 'Runden-Start' };

// Passt eine 1600×900-Folie in jeden Kasten ein (wie "object-fit: contain")
export const FitStage = ({ children, className = '', style = {} }) => {
  const ref = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const scale = box.w && box.h ? Math.min(box.w / SLIDE_W, box.h / SLIDE_H) : 0;
  return (
    <div ref={ref} className={`relative w-full h-full overflow-hidden ${className}`} style={style}>
      {scale > 0 && (
        <div style={{ position: 'absolute', width: SLIDE_W, height: SLIDE_H, left: (box.w - SLIDE_W * scale) / 2, top: (box.h - SLIDE_H * scale) / 2, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      )}
    </div>
  );
};

const Waves = ({ t }) => (
  <svg width={SLIDE_W} height="110" viewBox="0 0 1600 110" preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, display: 'block' }}>
    <path d="M0 50 C 200 15, 400 85, 600 50 S 1000 15, 1200 50 S 1500 85, 1600 50 L1600 110 L0 110 Z" fill={t.wave1} opacity="0.45" />
    <path d="M0 72 C 220 45, 420 100, 640 72 S 1040 45, 1260 72 S 1500 98, 1600 74 L1600 110 L0 110 Z" fill={t.wave2} opacity="0.35" />
  </svg>
);

const AnchorIcon = ({ color, size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="5" r="2" /><path d="M12 7v14M5 12H3a9 9 0 0 0 18 0h-2M8 10h8" />
  </svg>
);

const Captain = ({ q, t, size = 400, style = {} }) => (
  <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', ...style }}>
    {q.captainText && (
      <div style={{ background: '#FFFFFF', color: '#14284B', border: '4px solid #14284B', borderRadius: '32px 32px 32px 8px', padding: '18px 28px', boxShadow: '0 8px 0 #14284B', fontFamily: "'DM Serif Display', serif", fontSize: 38, lineHeight: 1.15, maxWidth: 460, marginBottom: 12, alignSelf: 'flex-end', marginRight: -40, textAlign: 'left', whiteSpace: 'pre-line' }}>
        {q.captainText}
      </div>
    )}
    <img src="/logo.png" alt="Der Quizkopp" style={{ width: size, height: size, objectFit: 'contain', filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.25))' }} />
  </div>
);

const Pill = ({ t, children }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: t.pill, color: t === SLIDE_THEMES.cream ? '#F4E9D4' : t.text, borderRadius: 999, padding: '10px 26px', fontSize: 26, fontWeight: 900, letterSpacing: '0.16em' }}>
    {children}
  </div>
);

const GoldBar = ({ t }) => <div style={{ width: 190, height: 10, borderRadius: 5, background: t === SLIDE_THEMES.cream ? '#D4A12A' : t.accent, margin: '28px 0' }} />;

const PauseCountdown = ({ minutes, t }) => {
  const total = Math.max(0, Math.round((Number(minutes) || 0) * 60));
  const [left, setLeft] = useState(total);
  useEffect(() => {
    setLeft(total);
    if (!total) return;
    const end = Date.now() + total * 1000;
    const id = setInterval(() => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000))), 500);
    return () => clearInterval(id);
  }, [total]);
  if (!total) return null;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 230, lineHeight: 1, color: t.accent, letterSpacing: '0.04em' }}>{mm}:{ss}</div>;
};

const BulletList = ({ items, visible, t, big = true }) => {
  const twoCols = items.length > 5;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: twoCols ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', columnGap: 56, rowGap: twoCols ? 22 : 28 }}>
      {items.map((b, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 20, opacity: i < visible ? 1 : 0, transform: i < visible ? 'none' : 'translateY(20px)', transition: 'opacity .5s ease, transform .5s ease' }}>
          <AnchorIcon color={t.accent} size={twoCols ? 34 : 42} />
          <span style={{ fontSize: twoCols ? (big ? 34 : 30) : (big ? 42 : 34), fontWeight: 700, lineHeight: 1.25, color: t.text }}>{b}</span>
        </div>
      ))}
    </div>
  );
};

// Die eigentliche Folie (immer 1600 × 900)
export const SlideCanvas = ({ q, room }) => {
  const layout = getSlideLayout(q);
  const t = SLIDE_THEMES[q.slideBg] || SLIDE_THEMES.navy;
  const base = { width: SLIDE_W, height: SLIDE_H, position: 'relative', overflow: 'hidden', background: t.bg, color: t.text, fontFamily: "'Nunito', sans-serif", boxSizing: 'border-box' };
  const titleFont = { fontFamily: "'DM Serif Display', serif", fontWeight: 400, margin: 0, color: t.title, lineHeight: 1.05 };
  const showCaptain = q.showCaptain !== false;

  if (layout === 'image') {
    return (
      <div style={{ ...base, background: '#000' }}>
        {q.imgUrl
          ? <QuizImage src={q.imgUrl} className="w-full h-full object-contain" placeholderClassName="w-full h-full flex items-center justify-center text-white/40 text-4xl animate-pulse" />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 40 }}>Noch kein Bild</div>}
      </div>
    );
  }

  const bullets = getSlideBullets(q);
  const visible = usesBulletReveal(q) ? Math.min(bullets.length, room?.slideStep ?? 0) : bullets.length;
  const roundNo = room && layout === 'round' ? getRoundNumber(room.questions || [], room.currentQuestionIndex) : null;
  const contentLeft = showCaptain && ['title', 'round', 'pause'].includes(layout) ? 600 : 110;

  let content = null;
  if (layout === 'title' || layout === 'round') {
    content = (
      <div style={{ position: 'absolute', left: contentLeft, right: 110, top: 0, bottom: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {layout === 'round' && <div><Pill t={t}>RUNDE {roundNo || ''}</Pill></div>}
        <h1 style={{ ...titleFont, fontSize: (q.q || '').length > 28 ? 104 : 136, marginTop: layout === 'round' ? 30 : 0 }}>{q.q || (layout === 'round' ? 'Neue Runde' : 'Der Quizkopp')}</h1>
        <GoldBar t={t} />
        {q.note && <p style={{ margin: 0, fontSize: 44, fontWeight: 700, color: t.sub, lineHeight: 1.3, whiteSpace: 'pre-line' }}>{q.note}</p>}
        {layout === 'round' && bullets.length > 0 && <div style={{ marginTop: 34 }}><BulletList items={bullets} visible={bullets.length} t={t} big={false} /></div>}
      </div>
    );
  } else if (layout === 'rules') {
    content = (
      <div style={{ position: 'absolute', left: 110, right: showCaptain ? 430 : 110, top: 80, bottom: 130, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ ...titleFont, fontSize: 92 }}>{q.q || 'Die Regeln'}</h1>
        <GoldBar t={t} />
        <BulletList items={bullets} visible={visible} t={t} />
      </div>
    );
  } else if (layout === 'imageText') {
    content = (
      <div style={{ position: 'absolute', left: 90, right: showCaptain ? 400 : 110, top: 80, bottom: 140, display: 'flex', gap: 70, alignItems: 'center' }}>
        <div style={{ width: showCaptain ? 620 : 760, height: 620, borderRadius: 36, overflow: 'hidden', background: 'rgba(0,0,0,0.15)', flexShrink: 0, boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
          {q.imgUrl
            ? <QuizImage src={q.imgUrl} className="w-full h-full object-cover" placeholderClassName="w-full h-full flex items-center justify-center text-white/40 text-3xl animate-pulse" />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: t.sub }}>Bild einfügen</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ ...titleFont, fontSize: (q.q || '').length > 30 ? 72 : 92 }}>{q.q || 'Überschrift'}</h1>
          <GoldBar t={t} />
          {q.note && <p style={{ margin: 0, fontSize: 38, fontWeight: 600, lineHeight: 1.4, color: t.text, whiteSpace: 'pre-line' }}>{q.note}</p>}
        </div>
      </div>
    );
  } else if (layout === 'quote') {
    content = (
      <div style={{ position: 'absolute', left: 160, right: showCaptain ? 470 : 160, top: 0, bottom: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 220, lineHeight: 0.6, color: t.accent, opacity: 0.6 }}>„</div>
        <p style={{ fontFamily: "'DM Serif Display', serif", fontStyle: 'italic', margin: 0, fontSize: (q.q || '').length > 90 ? 64 : 84, lineHeight: 1.18, color: t.title }}>{q.q || 'Wusstet ihr schon …?'}</p>
        {q.note && <p style={{ margin: '36px 0 0', fontSize: 34, fontWeight: 800, color: t.sub, letterSpacing: '0.04em' }}>— {q.note}</p>}
      </div>
    );
  } else if (layout === 'pause') {
    content = (
      <div style={{ position: 'absolute', left: contentLeft, right: 110, top: 0, bottom: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div><Pill t={t}>PAUSE</Pill></div>
        <h1 style={{ ...titleFont, fontSize: 120, marginTop: 30 }}>{q.q || 'Kurze Pause'}</h1>
        <GoldBar t={t} />
        <PauseCountdown minutes={q.pauseMinutes} t={t} />
        {q.note && <p style={{ margin: '20px 0 0', fontSize: 42, fontWeight: 700, color: t.sub, whiteSpace: 'pre-line' }}>{q.note}</p>}
      </div>
    );
  }

  return (
    <div style={base}>
      <style>{`@keyframes qkSlideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: none; } }`}</style>
      <div style={{ position: 'absolute', inset: 0, animation: 'qkSlideIn .7s ease-out both' }}>{content}</div>
      {showCaptain && (['title', 'round', 'pause'].includes(layout)
        ? <Captain q={q} t={t} size={470} style={{ left: 70, bottom: 70 }} />
        : <Captain q={q} t={t} size={330} style={{ right: 70, bottom: 80 }} />)}
      <Waves t={t} />
    </div>
  );
};
