import React, { useState } from 'react';
import { ScaledStage } from '../components/ui';
import { getOrderItems, getOrderShuffle, isInfoItem } from '../lib/helpers';
import { HostDashboard } from './HostDashboard';
import { PlayerDashboard } from './PlayerDashboard';

// --- LIVE-VORSCHAU IM EDITOR ---
// Zeigt die echte Beamer- bzw. Handy-Ansicht, verkleinert und mit Beispiel-Teams.

const DEMO_PLAYERS = [
  { id: 'pv1', name: 'Anna', team: 'Team Rot', score: 12 },
  { id: 'pv2', name: 'Ben', team: 'Team Blau', score: 9 },
  { id: 'pv3', name: 'Cem', team: 'Team Grün', score: 7 },
];

// Beispiel-Antworten, damit die Auflösung nicht leer aussieht
const demoAnswer = (q, i) => {
  switch (q.type) {
    case 'multiple': return [q.correctIndex, (Number(q.correctIndex) + 1) % 4, q.correctIndex][i];
    case 'geo': return { lat: Number(q.targetLat) + [1.2, -0.8, 2.6][i], lng: Number(q.targetLng) + [-1.6, 1.1, 0.5][i] };
    case 'estimation': { const c = parseFloat(String(q.correctValue).replace(',', '.')) || 100; return String(Math.round(c * [0.9, 1.25, 1.04][i])); }
    case 'order': { const n = getOrderItems(q).length; return i === 0 ? [...Array(n).keys()] : getOrderShuffle(q); }
    case 'text': case 'zoom': case 'step': return ['Beispielantwort', q.correctValue || 'Richtige Antwort', '???'][i];
    default: return null;
  }
};

const noop = () => {};

const Seg = ({ options, value, onChange }) => (
  <div className="inline-flex bg-slate-100 rounded-xl p-1">
    {options.map(([k, label]) => (
      <button key={k} onClick={() => onChange(k)} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${value === k ? 'bg-white shadow text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}>{label}</button>
    ))}
  </div>
);

export function EditorPreview({ qs, index, allowJokers, onClose }) {
  const [mode, setMode] = useState('beamer');
  const [stage, setStage] = useState('active');
  const q = qs[index];
  if (!q) return null;

  const info = isInfoItem(q);
  const revealed = !info && stage === 'revealed';
  const room = {
    id: 'DEMO',
    status: revealed ? 'revealed' : 'active',
    currentQuestionIndex: index,
    currentStepIndex: q.type === 'step' && revealed ? Math.max(0, (q.steps || []).length - 1) : 0,
    questions: qs,
    timeLeft: q.timer || 0,
    timerPaused: false,
    buzzerWinner: null,
    buzzerLockedOut: [],
    teamScores: {},
    allowJokers,
    geoStage: q.type === 'geo' && revealed ? 'target' : null,
    lastRanking: [],
    podiumStep: 0,
  };
  const players = DEMO_PLAYERS.map((p, i) => {
    const ans = revealed ? demoAnswer(q, i) : null;
    const orderOk = q.type === 'order' && revealed && i === 0;
    return {
      ...p, roomCode: 'DEMO', answers: {}, awarded: {}, jokerUsed: false, jokerQuestion: null, isBullseye: false, stepLockedIn: null,
      currentAnswer: ans,
      corrected: false,
      wasCorrect: revealed && q.type === 'multiple' ? Number(ans) === Number(q.correctIndex) : (revealed && q.type === 'order' ? orderOk : null),
      currentAwardedPoints: orderOk ? 1 : 0,
    };
  });

  return (
    <div className="bg-white rounded-3xl border border-sky-100 shadow-sm p-4 mb-6">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="font-bold text-slate-600">👀 Vorschau</span>
        <Seg options={[['beamer', '📺 Beamer'], ['phone', '📱 Handy']]} value={mode} onChange={setMode} />
        {!info && <Seg options={[['active', 'Frage'], ['revealed', 'Auflösung']]} value={stage} onChange={setStage} />}
        {onClose && <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600 font-bold">Ausblenden</button>}
      </div>

      {mode === 'beamer' ? (
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-[#F0F9FF]">
          <ScaledStage width={1600} height={900}>
            <div className="w-full h-full bg-[#F0F9FF] p-8 overflow-hidden text-[#1E293B] font-sans">
              <HostDashboard key={`${index}-${stage}`} room={room} players={players} isBeamer={true} soundOn={false}
                onReveal={noop} onNext={noop} onPrev={noop} onCorrect={noop} onBuzzerCorrect={noop} onBuzzerWrongContinue={noop} db={null} />
            </div>
          </ScaledStage>
        </div>
      ) : (
        <div className="mx-auto rounded-[2rem] border-[10px] border-slate-800 overflow-hidden bg-[#F0F9FF] shadow-lg" style={{ width: 300 }}>
          <ScaledStage width={390} height={760} interactive>
            <div className="w-full h-full overflow-y-auto p-4 bg-[#F0F9FF] text-[#1E293B] font-sans">
              <PlayerDashboard key={`${index}-${stage}`} room={room} player={players[0]} players={players} onAnswer={noop} onBuzz={noop} onUseJoker={noop} />
            </div>
          </ScaledStage>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-2">Mit Beispiel-Teams und Beispiel-Antworten – nur zur Ansicht, es wird nichts gespeichert.</p>
    </div>
  );
}
