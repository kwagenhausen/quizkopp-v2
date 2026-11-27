import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle, Clock, Pause, Play, Trophy } from 'lucide-react';
import { GeoMap, MapErrorBoundary } from '../components/GeoMap';
import { Confetti, QuizImage, TeamAvatar, ZoomImage, useZoomProgress } from '../components/ui';
import { calculateDistance, countOrderCorrect, getMediaType, getOrderItems, getOrderShuffle, getPlayerStyle, getPodiumSize, getQuestionNumber, getRoundNumber, getSortedTeams, isInfoItem, isManualGraded, isPlaceRevealed, isSlideLike, vibrate } from '../lib/helpers';

export function PlayerDashboard({ room, player, players, onAnswer, onBuzz, onUseJoker }) {
  const q = room.questions[room.currentQuestionIndex];
  
  const initialAnswer = () => q.type === 'geo' ? null : q.type === 'order' ? getOrderShuffle(q) : '';
  const [v, setV] = useState(initialAnswer);
  const zoomProgress = useZoomProgress(room, q);
  const [qStartTime, setQStartTime] = useState(Date.now());
  const sortedTeams = getSortedTeams(players, room);
  
  useEffect(() => {
    setV(initialAnswer());
    setQStartTime(Date.now()); 
  }, [room.currentQuestionIndex, q.type]);

  // Vibration: neue Frage, Ergebnis
  useEffect(() => {
    if (room.status === 'active' && !isInfoItem(q)) vibrate(60);
  }, [room.currentQuestionIndex]);
  useEffect(() => {
    if (!player || room.status !== 'revealed') return;
    const needsGrading = isManualGraded(q);
    if (needsGrading && !player.corrected) return;
    if (player.wasCorrect === true) vibrate([80, 60, 140]);
    else if (player.wasCorrect === false) vibrate(250);
  }, [player?.wasCorrect, player?.corrected, room.status]);

  if (!player) return null;
  
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
    vibrate(120);
    onBuzz(reactionTimeMs);
  };

  if (room.status === 'lobby') return (
    <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700">
      <div className="mb-6"><TeamAvatar style={getPlayerStyle(player, players)} size="xl" /></div>
      <h2 className="text-2xl font-bold">Hallo {player.name}!</h2>
      {player.team && <div className="mt-4 text-lg font-bold inline-block px-6 py-2 rounded-full border-2" style={{ color: getPlayerStyle(player, players).color, borderColor: getPlayerStyle(player, players).color, backgroundColor: `${getPlayerStyle(player, players).color}12` }}>Dein Team: {player.team}</div>}
      <p className="mt-8 animate-pulse text-[#E69F00]">Warte auf Start...</p>
    </div>
  );
  
  if (room.status === 'finished') {
    const myTeamId = player.team && player.team.trim() !== "" ? player.team.trim() : player.name;
    const myTeam = sortedTeams.find(t => t.name === myTeamId);
    const myRank = sortedTeams.findIndex(t => t.name === myTeamId) + 1;
    
    const podiumStepP = room.podiumStep ?? getPodiumSize(sortedTeams);
    if (myRank > 0 && !isPlaceRevealed(myRank, sortedTeams.length, podiumStepP)) {
      return (
        <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700">
          <div className="text-6xl mb-6 animate-bounce">🥁</div>
          <h2 className="text-2xl font-bold mb-2">Siegerehrung läuft!</h2>
          <p className="text-slate-500 px-6">Schau nach vorne – gleich wird enthüllt, wo ihr gelandet seid …</p>
        </div>
      );
    }

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
  
  if (isSlideLike(q)) {
    return (
      <div className="text-center py-10 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700 px-4">
        {q.type === 'round' && !(q.showImg && q.imgUrl) ? (
          <div className="py-8">
            <div className="text-5xl mb-4">🎬</div>
            <div className="text-sm font-black tracking-[0.3em] text-sky-500 mb-2">RUNDE {getRoundNumber(room.questions, room.currentQuestionIndex)}</div>
            <h2 className="text-3xl font-bold text-[#E69F00]">{q.q}</h2>
            <p className="text-slate-500 mt-4">Gleich geht's los …</p>
          </div>
        ) : q.showImg && q.imgUrl ? (
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
      } else if ((isManualGraded(q) || q.type === 'order') && player.currentAwardedPoints !== undefined) {
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
        <span className="flex items-center gap-2"><TeamAvatar style={getPlayerStyle(player, players)} size="xs" /> Frage {getQuestionNumber(room.questions, room.currentQuestionIndex)}</span>
        {q.isJoker && <span className="text-amber-500 font-black animate-pulse bg-amber-50 px-2 py-1 rounded">🌟 2 PUNKTE</span>}
        {q.timer === 0 && <span className="flex items-center gap-1 text-[#E69F00]"><Clock size={12}/> ∞</span>}
      </div>

      {q.timer > 0 && room.status === 'active' && !timeIsUp && (
        <div className="flex justify-center my-4">
           <div className={`flex items-center gap-3 px-8 py-3 rounded-full border-4 shadow-lg font-mono text-4xl font-bold transition-all duration-300 ${room.timeLeft <= 5 ? 'bg-red-50 border-red-500 text-red-600 animate-pulse scale-110' : 'bg-white border-sky-100 text-[#E69F00]'}`}>
              {room.timerPaused ? <Pause size={36}/> : <Clock size={36}/>} {room.timeLeft}s
           </div>
        </div>
      )}

      <h2 className="text-2xl font-bold leading-tight mb-2">{q.q}</h2>
      
      {q.type === 'zoom' && q.imgUrl && q.showImg && <ZoomImage q={q} progress={zoomProgress} revealed={room.status === 'revealed'} maxH="35vh" />}
      {q.type !== 'zoom' && q.imgUrl && q.showImg && getMediaType(q.imgUrl) === 'image' && <QuizImage src={q.imgUrl} className="w-full h-48 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 shadow-sm"/>}
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
          
          {q.type === 'order' && (() => {
              const items = getOrderItems(q);
              const cur = Array.isArray(v) && v.length === items.length ? v : getOrderShuffle(q);
              const move = (i, dir) => { const n = [...cur]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setV(n); };
              return (
                <div className="space-y-3">
                  {q.orderHint && <p className="text-sm text-slate-500 text-center font-semibold">↕️ {q.orderHint}</p>}
                  {cur.map((itemIdx, pos) => (
                    <div key={itemIdx} className="flex items-center gap-2 bg-white p-3 rounded-2xl border border-sky-100 shadow-sm transition-all">
                      <span className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 font-black flex items-center justify-center flex-shrink-0">{pos + 1}</span>
                      <span className="flex-1 font-medium leading-snug">{items[itemIdx]}</span>
                      <button onClick={() => move(pos, -1)} disabled={pos === 0} className="p-3 rounded-xl bg-slate-50 active:bg-sky-100 disabled:opacity-25" aria-label="Nach oben"><ArrowUp size={20}/></button>
                      <button onClick={() => move(pos, 1)} disabled={pos === cur.length - 1} className="p-3 rounded-xl bg-slate-50 active:bg-sky-100 disabled:opacity-25" aria-label="Nach unten"><ArrowDown size={20}/></button>
                    </div>
                  ))}
                  <button onClick={() => onAnswer(cur)} className="w-full bg-[#E69F00] text-white py-4 rounded-2xl font-bold shadow-md">Reihenfolge einloggen</button>
                </div>
              );
          })()}

          {(q.type === 'text' || q.type === 'estimation' || q.type === 'step' || q.type === 'zoom') && (
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
      
      {room.status === 'revealed' && isManualGraded(q) && !player.corrected && (
          <div className="py-12 rounded-3xl border-2 text-center bg-slate-50 border-sky-100 text-slate-400 shadow-inner animate-pulse">
             <h3 className="text-xl font-bold">{q.type === 'geo' && room.geoStage === 'pins' ? '📍 Alle Tipps sind jetzt vorne zu sehen!' : 'Quizmaster wertet aus...'}</h3>
             <p className="text-sm mt-2">{q.type === 'geo' && room.geoStage === 'pins' ? 'Gleich wird das Ziel aufgelöst …' : 'Warte auf die Entscheidung.'}</p>
          </div>
      )}
      
      {room.status === 'revealed' && (!isManualGraded(q) || player.corrected) && typeof player.wasCorrect === 'boolean' && (
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

                 {q.type === 'order' && (
                     <div className="mt-6 text-left bg-white rounded-2xl p-4 border border-slate-200 text-slate-700">
                         <span className="text-xs uppercase font-bold tracking-widest block mb-3 text-slate-500 text-center">
                             Richtige Reihenfolge{Array.isArray(player.currentAnswer) ? ` – du hattest ${countOrderCorrect(q, player.currentAnswer)} von ${getOrderItems(q).length} richtig` : ''}
                         </span>
                         {getOrderItems(q).map((item, i) => {
                             const ok = Array.isArray(player.currentAnswer) && player.currentAnswer[i] === i;
                             return <div key={i} className="flex items-center gap-2 py-1 text-sm"><span className="w-6 font-black text-slate-400">{i + 1}.</span><span className="flex-1 font-medium">{item}</span><span>{Array.isArray(player.currentAnswer) ? (ok ? '✅' : '❌') : ''}</span></div>;
                         })}
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
