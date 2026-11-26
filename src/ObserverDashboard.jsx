import React from 'react';
import { Clock, Play, Trophy } from 'lucide-react';
import { Confetti, QuizImage } from '../components/ui';
import { getMediaType, getQuestionNumber, getRoundNumber, getSortedTeams, isPlaceRevealed, isSlideLike } from '../lib/helpers';

export function ObserverDashboard({ room, players }) {
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
            {sortedTeams.slice(0, 3).map((t, i) => !isPlaceRevealed(i + 1, sortedTeams.length, room.podiumStep ?? 3) ? (
                <div key={t.name} className="flex justify-center items-center p-3 rounded-xl border border-dashed border-sky-200 text-slate-400 font-bold animate-pulse">🥁 Platz {i + 1} …</div>
            ) : (
                <div key={t.name} className={`flex justify-between items-center p-3 rounded-xl border ${i===0 ? 'bg-yellow-50 border-[#E69F00]' : 'bg-slate-50 border-sky-50'}`}>
                    <span className="font-bold">{i+1}. {t.name}</span>
                    <span className="text-[#E69F00] font-bold">{t.totalScore} Pkt</span>
                </div>
            ))}
        </div>
      </div>
    );
  }

  if (isSlideLike(q)) {
    return (
      <div className="text-center py-10 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700 px-4">
        {q.type === 'round' && <div className="text-sm font-black tracking-[0.3em] text-sky-500 mb-3">🎬 RUNDE {getRoundNumber(room.questions, room.currentQuestionIndex)}</div>}
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
