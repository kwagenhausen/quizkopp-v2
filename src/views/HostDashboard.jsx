import React, { useEffect, useRef, useState } from 'react';
import { deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Bell, CheckCircle, ChevronLeft, ChevronRight, Clock, Download, Maximize, MessageSquare, Monitor, Pause, Plus, Smartphone, Trophy, Users, XCircle } from 'lucide-react';
import { GeoMap, MapErrorBoundary } from '../components/GeoMap';
import { AnimatedRanking, Confetti, Podium, QuizImage, ScaledStage, TeamAvatar, TextSlide, ZoomImage, useZoomProgress } from '../components/ui';
import { db } from '../firebase';
import { TEAM_STYLES, calculateDistance, countOrderCorrect, downloadCSV, fmtPts, getMediaType, getOrderItems, getOrderShuffle, getPlayerStyle, getPodiumSize, getQuestionNumber, getQuestionTotal, getRoundNumber, getSolutionText, getSortedTeams, getYouTubeEmbedUrl, isInfoItem, isManualGraded, isSlideLike, toggleFullscreen } from '../lib/helpers';
import { preloadImages } from '../lib/images';
import { getItemTitle, getTypeInfo } from '../lib/questionTypes';
import { Sound } from '../lib/sound';
import { PlayerDashboard } from './PlayerDashboard';

export function HostDashboard({ room, players, onReveal, onNext, onPrev, soundOn = true, moderatorMode = false, onCorrect, onBuzzerCorrect, onBuzzerWrongContinue, db, isBeamer = false }) {
  const q = room.questions[room.currentQuestionIndex];
  const nextQ = room.questions[room.currentQuestionIndex + 1]; 
  const isLastQuestion = room.currentQuestionIndex >= room.questions.length - 1;
  const sortedTeams = getSortedTeams(players, room);
  const presenter = moderatorMode && !isBeamer; // Moderatoren-Ansicht: Regie statt Bühne
  const geoPinsStage = q?.type === 'geo' && room.status === 'revealed' && room.geoStage === 'pins';
  const podiumSize = getPodiumSize(sortedTeams);
  const podiumStep = room.podiumStep ?? podiumSize; // alte Räume: alles sofort sichtbar
  const podiumDone = podiumStep >= podiumSize;
  const canGoBack = room.status === 'finished' || (room.status !== 'lobby' && room.currentQuestionIndex > 0);
  
  const [showBuzzerAnswer, setShowBuzzerAnswer] = useState(false);
  const [numTeams, setNumTeams] = useState(2); 
  const [showSimulator, setShowSimulator] = useState(false);
  const [simPos, setSimPos] = useState({ 
    x: typeof window !== 'undefined' ? window.innerWidth - 420 : 800, 
    y: 80 
  });
  
  const [liveEstValue, setLiveEstValue] = useState('');
  const zoomProgress = useZoomProgress(room, q || {});

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
  const goPrev = () => { if (canGoBack) runOnce(onPrev); };
  const podiumNext = () => runOnce(() => updateDoc(doc(db, 'rooms', room.id), { podiumStep: podiumStep + 1 }));
  const togglePause = () => runOnce(() => updateDoc(doc(db, 'rooms', room.id), { timerPaused: !room.timerPaused }));

  // Sounds auf Beamer / Host (über den Lautsprecher-Knopf oben ein- und ausschaltbar)
  const soundPrev = useRef(null);
  useEffect(() => {
    const cur = { idx: room.currentQuestionIndex, status: room.status, timeLeft: room.timeLeft, geoStage: room.geoStage, buzzer: room.buzzerWinner, podium: room.podiumStep || 0 };
    const prev = soundPrev.current;
    soundPrev.current = cur;
    if (!prev || !soundOn) return;
    const sameQ = prev.idx === cur.idx;
    if (sameQ && cur.status === 'active' && prev.timeLeft !== cur.timeLeft) {
      if (cur.timeLeft > 0 && cur.timeLeft <= 5) Sound.tick();
      if (prev.timeLeft > 0 && cur.timeLeft === 0) Sound.timeUp();
    }
    if (sameQ && prev.status === 'active' && cur.status === 'revealed') { if (q?.type === 'geo') Sound.pop(); else Sound.reveal(); }
    if (sameQ && prev.geoStage === 'pins' && cur.geoStage === 'target') Sound.reveal();
    if (!prev.buzzer && cur.buzzer) Sound.buzzer();
    if (!sameQ && cur.status === 'active' && q?.type === 'break') Sound.swoosh();
    if (prev.status !== 'finished' && cur.status === 'finished') Sound.pop();
    if (cur.status === 'finished' && cur.podium > prev.podium) Sound.fanfare(cur.podium >= podiumSize);
  }, [room.currentQuestionIndex, room.status, room.timeLeft, room.geoStage, room.buzzerWinner, room.podiumStep, soundOn]);

  // Weiterschalten per Tastatur oder Presenter-Klicker (→, Leertaste, Bild↓, Enter)
  useEffect(() => {
    if (isBeamer || room.status === 'lobby' || !q) return;
    const onKey = (e) => {
      if (e.repeat) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); goPrev(); return; }
      if ((e.key === 'p' || e.key === 'P') && room.status === 'active' && q.timer > 0) { e.preventDefault(); togglePause(); return; }
      if (!['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) return;
      if (room.status === 'finished') {
        if (!podiumDone) { e.preventDefault(); podiumNext(); }
        return;
      }
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
      
      // Teams bekommen Tiernamen & -farben: "Die Füchse", "Die Frösche", …
      shuffled.forEach((p, index) => {
        const i = index % numTeams;
        const st = TEAM_STYLES[i % TEAM_STYLES.length];
        const name = i < TEAM_STYLES.length ? `Die ${st.name}` : `Team ${i + 1}`;
        batch.update(doc(db, 'players', p.id), { team: name, teamStyle: i % TEAM_STYLES.length });
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
        {canGoBack && (
          <>
            <button onClick={goPrev} className="p-2 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700 flex items-center gap-1 text-sm font-bold" title="Einen Schritt zurück (← oder Bild↑)">
              <ChevronLeft size={22}/> Zurück
            </button>
            <div className="w-px h-8 bg-sky-100 mx-1"></div>
          </>
        )}
        <button onClick={toggleSimulator} className={`p-2 rounded-xl transition-colors ${showSimulator ? 'bg-sky-100 text-sky-600' : 'text-slate-400 hover:bg-slate-50'}`} title="Handy-Simulator öffnen/schließen">
            <Smartphone size={24}/>
        </button>
        <div className="w-px h-8 bg-sky-100 mx-2"></div>
        <button onClick={() => window.open(`${window.location.origin}/?raum=${room.id}&ansicht=beamer`, 'quizkopp-beamer', 'popup,width=1280,height=720')} className="p-2 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-sky-600" title="Beamer-Fenster öffnen (auf den Beamer ziehen und Vollbild)">
            <Monitor size={22}/>
        </button>
        <div className="w-px h-8 bg-sky-100 mx-1"></div>
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
        <div className="flex flex-wrap gap-4 justify-center">
          {sortedTeams.map(t => (
            <div key={t.name} className="flex items-center gap-3 bg-white pl-2 pr-6 py-2 rounded-full border-2 shadow-sm" style={{ borderColor: t.style.color, backgroundColor: `${t.style.color}12` }}>
              <TeamAvatar style={t.style} size="md" />
              <span className="text-left">
                <span className="block text-xl font-bold text-slate-700 leading-tight">{t.name}</span>
                {(t.players.length > 1 || t.players[0]?.name !== t.name) && <span className="block text-sm text-slate-500">{t.players.map(p => p.name).join(', ')}</span>}
              </span>
            </div>
          ))}
        </div>
        
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
    <div className="space-y-10 max-w-5xl mx-auto py-6 text-slate-700 relative h-full">
      {podiumDone && <Confetti />}
      <h2 className="text-center text-6xl text-[#E69F00] font-bold relative z-10">🏆 Siegerehrung</h2>
      <div className="relative z-10"><Podium teams={sortedTeams} step={podiumStep} /></div>

      {sortedTeams.length > 3 && (
        <div className="bg-white rounded-3xl border border-sky-100 shadow-sm p-6 space-y-2 relative z-10 max-w-3xl mx-auto">
          {sortedTeams.slice(3).map((t, i) => (
            <div key={t.name} className="flex justify-between items-center px-4 py-2 rounded-xl bg-slate-50">
              <span className="font-bold text-slate-600">{i + 4}. {t.name}</span>
              <span className="font-mono font-bold text-[#E69F00]">{fmtPts(t.totalScore)}</span>
            </div>
          ))}
        </div>
      )}

      {!isBeamer && !podiumDone && (
        <button onClick={podiumNext} className="w-full max-w-3xl mx-auto block bg-[#E69F00] text-white py-6 rounded-3xl text-3xl font-bold shadow-xl hover:scale-[1.02] transition-all relative z-10">
          {podiumSize - podiumStep === 1 ? '🥁 Und der Sieger ist …' : podiumSize - podiumStep === 2 ? '🥈 Platz 2 enthüllen' : '🥉 Platz 3 enthüllen'}
        </button>
      )}
      {!isBeamer && podiumDone && <button onClick={()=>downloadCSV(players,room)} className="w-full bg-white border border-sky-100 py-6 rounded-3xl flex items-center justify-center gap-4 text-2xl font-bold mt-12 shadow-md text-slate-700 relative z-10"><Download size={32}/> Excel-Export (CSV)</button>}

      {!isBeamer && renderSimulatorAndButton()}
    </div>
  );

  if (isSlideLike(q) && presenter) {
    return (
      <>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-sky-100 shadow-2xl">
              <div className="flex justify-between items-center mb-4 text-sm font-bold text-slate-400 uppercase tracking-widest">
                <span>{getTypeInfo(q.type).icon} {q.type === 'round' ? `Runde ${getRoundNumber(room.questions, room.currentQuestionIndex)}` : getTypeInfo(q.type).label}</span>
                <span>📺 So sieht es der Beamer</span>
              </div>
              <div className="rounded-2xl overflow-hidden bg-black">
                <ScaledStage width={1600} height={900}>
                  <div className="w-full h-full bg-black flex items-center justify-center">
                    {q.imgUrl ? <QuizImage src={q.imgUrl} className="w-full h-full object-contain" placeholderClassName="text-white/40 text-4xl animate-pulse" /> : <TextSlide key={room.currentQuestionIndex} q={q} kicker={q.type === 'round' ? `RUNDE ${getRoundNumber(room.questions, room.currentQuestionIndex)}` : null} />}
                  </div>
                </ScaledStage>
              </div>
            </div>
            <div className="flex gap-4">
              {canGoBack && <button onClick={goPrev} className="px-8 py-6 rounded-3xl bg-white border border-sky-100 text-slate-500 hover:text-slate-800 text-2xl font-bold shadow-sm flex items-center gap-2"><ChevronLeft size={28}/> Zurück</button>}
              <button onClick={goNext} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-6 rounded-3xl text-3xl font-bold shadow-xl flex items-center justify-center gap-3">{isLastQuestion ? 'Zur Siegerehrung' : 'Weiter'} <ChevronRight size={32}/></button>
            </div>
          </div>
          <div className="space-y-6"><RegiePanel q={q} nextQ={nextQ} room={room} /></div>
        </div>
        {renderSimulatorAndButton()}
      </>
    );
  }

  if (isSlideLike(q)) {
    return (
      <div className={`fixed inset-0 z-[60] bg-black flex items-center justify-center select-none ${!isBeamer ? 'cursor-pointer' : ''}`} onClick={() => { if (!isBeamer) goNext(); }}>
        {q.imgUrl ? (
          <QuizImage src={q.imgUrl} className="w-full h-full object-contain" placeholderClassName="text-white/40 text-2xl animate-pulse" />
        ) : (
          <TextSlide key={room.currentQuestionIndex} q={q} kicker={q.type === 'round' ? `RUNDE ${getRoundNumber(room.questions, room.currentQuestionIndex)}` : null} />
        )}

        <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="absolute top-4 right-4 bg-white/10 hover:bg-white/30 text-white p-3 rounded-xl opacity-30 hover:opacity-100 transition-opacity" title="Vollbild an/aus">
          <Maximize size={20}/>
        </button>

        {!isBeamer && (
          <div onClick={(e) => e.stopPropagation()} className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 text-white pl-5 pr-3 py-3 rounded-2xl shadow-2xl opacity-40 hover:opacity-100 transition-opacity cursor-default">
            {canGoBack && <button onClick={goPrev} className="p-2 rounded-xl text-slate-300 hover:bg-white/10" title="Zurück"><ChevronLeft size={20}/></button>}
            <span className="font-mono text-sm text-[#E69F00] font-bold">{room.id}</span>
            <span className="text-xs text-slate-300 max-w-xs truncate">🔜 {nextQ ? (nextQ.q || getTypeInfo(nextQ.type).label) : 'Siegerehrung'}</span>
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
        
        {presenter && q.hostNotes && (
            <div className="bg-slate-800 text-white p-5 rounded-2xl shadow-lg"><span className="text-xs font-bold uppercase tracking-widest text-amber-300 block mb-1">📝 Deine Notiz</span><span className="whitespace-pre-line">{q.hostNotes}</span></div>
        )}
        <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl mb-8">
            <h3 className="text-2xl font-bold mb-6 text-slate-600 text-center">Aktuelles Ranking</h3>
            <AnimatedRanking key={room.currentQuestionIndex} teams={sortedTeams} previous={room.lastRanking} />
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
          emoji: getPlayerStyle(p, players).emoji,
          color: getPlayerStyle(p, players).color,
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
                 {q.type !== 'buzzer' && q.type !== 'step' && (
                   <button onClick={() => { if (!isBeamer && room.status === 'active' && q.timer > 0) togglePause(); }} disabled={isBeamer || room.status !== 'active' || !(q.timer > 0)}
                     className={`flex items-center gap-3 font-mono text-4xl font-bold px-6 py-2 rounded-full border transition-colors ${room.timerPaused && room.status === 'active' ? 'bg-sky-50 border-sky-300 text-sky-600' : 'bg-slate-50 border-sky-50 text-[#E69F00]'} ${!isBeamer && q.timer > 0 && room.status === 'active' ? 'hover:border-[#E69F00] cursor-pointer' : 'cursor-default'}`}
                     title={!isBeamer && q.timer > 0 ? 'Klicken (oder Taste P) zum Pausieren / Fortsetzen' : undefined}>
                     {room.timerPaused && room.status === 'active' ? <Pause size={32}/> : <Clock size={32}/>} {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}
                   </button>
                 )}
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
            {q.type === 'zoom' && q.imgUrl && (
              <div className="mb-8"><ZoomImage q={q} progress={zoomProgress} revealed={room.status === 'revealed'} maxH="50vh" /></div>
            )}
            {q.type !== 'zoom' && q.imgUrl && getMediaType(q.imgUrl) === 'image' && (
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

            {q.type === 'order' && (() => {
              const items = getOrderItems(q);
              const revealed = room.status === 'revealed';
              const shown = revealed ? items.map((_, i) => i) : getOrderShuffle(q);
              return (
                <div className="space-y-3 mb-8">
                  {q.orderHint && <p className="text-2xl text-slate-500 font-semibold mb-2">↕️ {q.orderHint}</p>}
                  {shown.map((itemIdx, pos) => (
                    <div key={itemIdx} className={`flex items-center gap-5 p-4 rounded-2xl border-2 text-2xl md:text-3xl font-bold transition-colors ${revealed ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-sky-100'}`}>
                      <span className={`w-14 h-14 rounded-xl flex items-center justify-center font-black flex-shrink-0 ${revealed ? 'bg-emerald-500 text-white' : 'bg-white text-sky-600 border border-sky-100'}`}>{revealed ? pos + 1 : 'ABCDEFGH'[pos]}</span>
                      {items[itemIdx]}
                    </div>
                  ))}
                </div>
              );
            })()}

            {room.status === 'revealed' && q.type === 'order' && (() => {
              const n = getOrderItems(q).length;
              const ranked = players.filter(p => Array.isArray(p.currentAnswer)).sort((a, b) => countOrderCorrect(q, b.currentAnswer) - countOrderCorrect(q, a.currentAnswer));
              if (ranked.length === 0) return null;
              return (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2 mb-6 border-t border-sky-100 pt-6">
                  <div className="col-span-full"><h3 className="text-xl font-bold text-slate-600">Wer hatte wie viel richtig?</h3></div>
                  {ranked.map(p => {
                    const c = countOrderCorrect(q, p.currentAnswer);
                    return (
                      <div key={p.id} className={`p-4 rounded-xl border-2 ${c === n ? 'bg-emerald-50 border-emerald-500' : 'bg-slate-50 border-sky-100'}`}>
                        <div className="font-bold text-slate-700 flex justify-between"><span className="flex items-center gap-2"><TeamAvatar style={getPlayerStyle(p, players)} size="xs" />{p.name} {p.team && <span className="text-xs text-slate-400 font-normal">({p.team})</span>}</span>{p.jokerQuestion === room.currentQuestionIndex && <span>🌟</span>}</div>
                        <div className="text-sm mt-1 flex justify-between"><span>{c}/{n} richtig</span><span className="font-bold text-emerald-600">{p.currentAwardedPoints > 0 ? `+${p.currentAwardedPoints}` : ''}</span></div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

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
                {(() => { const w = players.find(p => p.id === room.buzzerWinner); return w ? <div className="mb-4"><TeamAvatar style={getPlayerStyle(w, players)} size="xl" /></div> : null; })()}
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

            {room.status === 'revealed' && q.type !== 'buzzer' && q.type !== 'geo' && q.type !== 'order' && (
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
                                  <span className="flex items-center gap-2"><TeamAvatar style={getPlayerStyle(p, players)} size="xs" />{p.name} {p.team && <span className="text-xs text-slate-400 font-normal">({p.team})</span>}</span>
                                  {pUsedJoker && <span className="text-xl" title="Joker gespielt!">🌟</span>}
                              </div>
                              <div className="text-sm mt-1">{q.options[p.currentAnswer]}</div>
                          </div>
                        )
                    })}
                </div>
            )}

            {room.status === 'revealed' && q.type === 'estimation' && q.showAnswers !== false && renderEstimationAnswers()}
            
            {room.status === 'revealed' && !geoPinsStage && isManualGraded(q) && <div className="space-y-4 mt-8 border-t border-sky-100 pt-8">
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
                            
                            {(q.type === 'text' || q.type === 'zoom') && (
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
                      <p className="font-medium text-lg truncate max-w-xl">{nextQ.q || `${getTypeInfo(nextQ.type).icon} ${getTypeInfo(nextQ.type).label}`}</p>
                  </div>
                  <div className="text-right ml-4">
                      <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-lg text-xs font-bold uppercase block mb-1">{getTypeInfo(nextQ.type).label}</span>
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
        
        <div className="h-fit sticky top-24 space-y-6">
        {presenter && <RegiePanel q={q} nextQ={nextQ} room={room} />}
        <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl">
          <h3 className="text-2xl font-bold mb-8 uppercase tracking-widest text-slate-300">Team Ranking</h3>
          <div className="space-y-4">
              {sortedTeams.map((t, index) => (
                <div key={t.name} className="bg-slate-50 rounded-xl border border-sky-50 shadow-sm overflow-hidden" style={{ borderLeft: `6px solid ${t.style.color}` }}>
                  <div className="flex justify-between items-center p-4 bg-sky-50/50">
                    <span className="font-bold flex items-center gap-3 text-slate-700 min-w-0">
                      <span className="text-slate-400 text-sm">{index + 1}.</span>
                      <TeamAvatar style={t.style} size="sm" />
                      <span className="truncate">{t.name}</span>
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
      </div>

      {!isBeamer && renderSimulatorAndButton()}
    </>
  );
}

// --- REGIE-PANEL: nur in der Moderatoren-Ansicht auf deinem Laptop ---
export function RegiePanel({ q, nextQ, room }) {
  if (!q) return null;
  return (
    <div className="bg-slate-800 text-white p-6 rounded-3xl shadow-xl space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black tracking-widest text-sky-300 uppercase">🎤 Regie</h3>
        <span className="text-xs text-slate-400">{room.currentQuestionIndex + 1} / {room.questions.length}</span>
      </div>
      {!isInfoItem(q) && (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-emerald-300 mb-1">✅ Lösung</div>
          <div className="text-lg font-bold whitespace-pre-line leading-snug">{getSolutionText(q)}</div>
        </div>
      )}
      {q.hostNotes && (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-amber-300 mb-1">📝 Deine Notiz</div>
          <div className="text-base whitespace-pre-line text-slate-100 leading-relaxed">{q.hostNotes}</div>
        </div>
      )}
      {!isInfoItem(q) && q.note && (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-sky-300 mb-1">💡 Fun Fact (kommt bei der Auflösung)</div>
          <div className="text-sm whitespace-pre-line text-slate-300">{q.note}</div>
        </div>
      )}
      <div className="border-t border-slate-700 pt-4">
        <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">🔜 Danach</div>
        <div className="font-semibold">{nextQ ? `${getTypeInfo(nextQ.type).icon} ${getItemTitle(nextQ)}` : '🏆 Siegerehrung'}</div>
      </div>
      <div className="text-[11px] text-slate-400 leading-relaxed">⌨️ → / Leertaste: weiter · ←: zurück · P: Timer anhalten</div>
    </div>
  );
}
