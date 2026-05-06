import React, { useState, useEffect } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';

// --- DEINE FIREBASE KONFIGURATION (Bleibt gleich) ---
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

// --- HILFSFUNKTIONEN ---
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

// --- HAUPT-APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [allRooms, setAllRooms] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState('');

  useEffect(() => {
    signInAnonymously(auth);
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubR = onSnapshot(collection(db, 'rooms'), (s) => setAllRooms(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubP = onSnapshot(collection(db, 'players'), (s) => setAllPlayers(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsubR(); unsubP(); };
  }, [user]);

  const activeRoom = allRooms.find(r => r.id === currentRoomCode);
  const playersInRoom = allPlayers.filter(p => p.roomCode === currentRoomCode).sort((a, b) => b.score - a.score);
  const myProfile = allPlayers.find(p => p.id === user?.uid);

  // --- HOST LOGIK ---
  const createRoom = async (questions) => {
    const code = generateRoomCode();
    await setDoc(doc(db, 'rooms', code), {
      hostId: user.uid,
      status: 'lobby',
      currentQuestionIndex: 0,
      questions,
      createdAt: Date.now()
    });
    setCurrentRoomCode(code);
    setRole('host');
  };

  const startQuiz = () => updateDoc(doc(db, 'rooms', currentRoomCode), { status: 'active' });

  const revealAnswer = async () => {
    const roomRef = doc(db, 'rooms', currentRoomCode);
    const q = activeRoom.questions[activeRoom.currentQuestionIndex];

    if (q.type === 'multiple') {
      for (const p of playersInRoom) {
        if (p.currentAnswer == q.correctIndex) {
          await updateDoc(doc(db, 'players', p.id), { score: p.score + 1 });
        }
      }
    } else if (q.type === 'estimation') {
      // Finde den/die am nächsten dran sind
      const validPlayers = playersInRoom.filter(p => p.currentAnswer !== null && p.currentAnswer !== "");
      if (validPlayers.length > 0) {
        const target = parseFloat(q.correctValue);
        const diffs = validPlayers.map(p => Math.abs(parseFloat(p.currentAnswer) - target));
        const minDiff = Math.min(...diffs);
        for (const p of validPlayers) {
          if (Math.abs(parseFloat(p.currentAnswer) - target) === minDiff) {
            await updateDoc(doc(db, 'players', p.id), { score: p.score + 1 });
          }
        }
      }
    }
    // 'text' Fragen werden manuell über Buttons in der Host-View korrigiert
    await updateDoc(roomRef, { status: 'revealed' });
  };

  const manualCorrect = async (playerId, isCorrect) => {
    const p = playersInRoom.find(player => player.id === playerId);
    if (!p) return;
    await updateDoc(doc(db, 'players', playerId), { 
      score: isCorrect ? p.score + 1 : p.score,
      corrected: true,
      wasCorrect: isCorrect
    });
  };

  const nextQuestion = async () => {
    const isLast = activeRoom.currentQuestionIndex >= activeRoom.questions.length - 1;
    for (const p of playersInRoom) {
      await updateDoc(doc(db, 'players', p.id), { currentAnswer: null, corrected: false, wasCorrect: null });
    }
    await updateDoc(doc(db, 'rooms', currentRoomCode), {
      status: isLast ? 'finished' : 'active',
      currentQuestionIndex: isLast ? activeRoom.currentQuestionIndex : activeRoom.currentQuestionIndex + 1
    });
  };

  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade QuizKopp...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-10 shadow-lg">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Trophy className="text-yellow-400" />
            <h1 className="text-xl font-bold">QuizKopp Master</h1>
          </div>
          {role && (
            <button onClick={() => { if(role === 'host') deleteDoc(doc(db, 'rooms', currentRoomCode)); setRole(null); setCurrentRoomCode(''); }} className="bg-slate-700 hover:bg-red-600 px-3 py-1 rounded-md text-sm transition-colors flex items-center gap-2">
              <LogOut size={16}/> Beenden
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 py-8">
        {!role && <RoleSelection onHost={() => setRole('host_setup')} onJoin={async (code, name) => {
           await setDoc(doc(db, 'players', user.uid), { name, roomCode: code.toUpperCase(), score: 0, currentAnswer: null });
           setCurrentRoomCode(code.toUpperCase()); setRole('player');
        }} />}

        {role === 'host_setup' && <HostSetup onCreate={createRoom} onCancel={() => setRole(null)} />}

        {role === 'host' && activeRoom && (
          <HostDashboard 
            room={activeRoom} players={playersInRoom} 
            onStart={startQuiz} onReveal={revealAnswer} onNext={nextQuestion} 
            onManualCorrect={manualCorrect}
          />
        )}

        {role === 'player' && activeRoom && (
          <PlayerDashboard room={activeRoom} player={myProfile} onAnswer={async (val) => await updateDoc(doc(db, 'players', user.uid), { currentAnswer: val })} />
        )}
      </main>
    </div>
  );
}

// --- SUB-KOMPONENTEN ---

function RoleSelection({ onHost, onJoin }) {
  const [c, setC] = useState('');
  const [n, setN] = useState('');
  return (
    <div className="grid md:grid-cols-2 gap-8 mt-10">
      <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Users className="text-indigo-400"/> Teilnehmer</h2>
        <input type="text" placeholder="CODE" className="w-full bg-slate-900 p-3 rounded mb-4 text-center font-mono text-xl" value={c} onChange={e => setC(e.target.value.toUpperCase())} maxLength={4} />
        <input type="text" placeholder="Teamname" className="w-full bg-slate-900 p-3 rounded mb-6" value={n} onChange={e => setN(e.target.value)} />
        <button onClick={() => onJoin(c, n)} className="w-full bg-indigo-600 py-3 rounded-lg font-bold">Beitreten</button>
      </div>
      <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 flex flex-col justify-center text-center">
        <h2 className="text-2xl font-bold mb-4 flex justify-center items-center gap-2"><Play className="text-emerald-400"/> Quizmaster</h2>
        <button onClick={onHost} className="bg-emerald-600 py-4 rounded-lg font-bold">Neues Quiz erstellen</button>
      </div>
    </div>
  );
}

function HostSetup({ onCreate, onCancel }) {
  const [questions, setQuestions] = useState([{ type: 'multiple', q: '', options: ['', '', '', ''], correctIndex: 0, correctValue: '' }]);

  const addQ = () => setQuestions([...questions, { type: 'multiple', q: '', options: ['', '', '', ''], correctIndex: 0, correctValue: '' }]);
  const update = (i, f, v) => { const n = [...questions]; n[i][f] = v; setQuestions(n); };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Quiz-Konfiguration</h2>
        <button onClick={onCancel} className="text-slate-400">Abbrechen</button>
      </div>
      {questions.map((q, i) => (
        <div key={i} className="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
          <div className="flex gap-4">
             <div className="flex-1">
               <label className="text-xs text-slate-400 uppercase font-bold">Frage {i+1}</label>
               <input type="text" className="w-full bg-slate-900 p-2 rounded" value={q.q} onChange={e => update(i, 'q', e.target.value)} />
             </div>
             <div>
               <label className="text-xs text-slate-400 uppercase font-bold">Typ</label>
               <select className="w-full bg-slate-900 p-2 rounded" value={q.type} onChange={e => update(i, 'type', e.target.value)}>
                 <option value="multiple">Multiple Choice</option>
                 <option value="text">Freitext</option>
                 <option value="estimation">Schätzfrage</option>
               </select>
             </div>
          </div>

          {q.type === 'multiple' && (
            <div className="grid grid-cols-2 gap-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700">
                  <input type="radio" checked={q.correctIndex == oi} onChange={() => update(i, 'correctIndex', oi)} />
                  <input type="text" className="bg-transparent w-full" value={opt} onChange={e => { const no = [...q.options]; no[oi] = e.target.value; update(i, 'options', no); }} />
                </div>
              ))}
            </div>
          )}

          {q.type === 'estimation' && (
             <div>
               <label className="text-xs text-slate-400">Korrekter Wert (Zahl)</label>
               <input type="number" className="w-full bg-slate-900 p-2 rounded" value={q.correctValue} onChange={e => update(i, 'correctValue', e.target.value)} />
             </div>
          )}
          
          {q.type === 'text' && <p className="text-xs text-indigo-400">Info: Freitext-Antworten bewertest du live während des Quizzes.</p>}
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={addQ} className="flex-1 bg-slate-700 py-3 rounded-lg">+ Frage</button>
        <button onClick={() => onCreate(questions)} className="flex-1 bg-emerald-600 py-3 rounded-lg font-bold">Quiz starten</button>
      </div>
    </div>
  );
}

function HostDashboard({ room, players, onStart, onReveal, onNext, onManualCorrect }) {
  const q = room.questions[room.currentQuestionIndex];
  const answered = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== "").length;

  if (room.status === 'lobby') return (
    <div className="text-center space-y-8">
      <h2 className="text-4xl font-bold tracking-widest text-indigo-400">{room.id}</h2>
      <div className="bg-slate-800 p-6 rounded-xl">
        <h3 className="mb-4">Wartende Teams ({players.length}):</h3>
        <div className="flex flex-wrap gap-2 justify-center">
          {players.map(p => <span key={p.id} className="bg-slate-700 px-3 py-1 rounded-full">{p.name}</span>)}
        </div>
      </div>
      <button onClick={onStart} className="bg-emerald-600 px-10 py-4 rounded-full text-xl font-bold">Start!</button>
    </div>
  );

  if (room.status === 'finished') return (
    <div className="space-y-4">
      <h2 className="text-3xl font-bold text-center text-yellow-400">🏆 Endstand</h2>
      {players.map((p, i) => (
        <div key={p.id} className="bg-slate-800 p-4 rounded-xl flex justify-between items-center border border-slate-700">
          <span>{i+1}. {p.name}</span>
          <span className="font-mono text-xl">{p.score} Pkt.</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-6">
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 relative overflow-hidden">
          <div className="flex items-center gap-2 text-indigo-400 mb-2 font-bold uppercase text-xs">
            {q.type === 'multiple' ? <List size={14}/> : q.type === 'text' ? <MessageSquare size={14}/> : <Hash size={14}/>}
            {q.type}
          </div>
          <h2 className="text-3xl font-bold mb-8">{q.q}</h2>
          
          {room.status === 'revealed' && (
            <div className="bg-emerald-500/20 border border-emerald-500 p-4 rounded-lg mb-6">
              Lösung: <span className="font-bold">{q.type === 'multiple' ? q.options[q.correctIndex] : q.type === 'estimation' ? q.correctValue : 'Manuelle Auswertung'}</span>
            </div>
          )}

          {/* Manuelle Korrektur Liste für Textfragen */}
          {room.status === 'revealed' && q.type === 'text' && (
            <div className="space-y-2 mt-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase">Antworten korrigieren:</h3>
              {players.map(p => (
                <div key={p.id} className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-700">
                  <div>
                    <span className="text-xs text-slate-500">{p.name}:</span>
                    <p className="font-semibold italic">"{p.currentAnswer || 'Keine Antwort'}"</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => onManualCorrect(p.id, false)} className={`p-2 rounded ${p.corrected && !p.wasCorrect ? 'bg-red-600' : 'bg-slate-700'}`}><XCircle size={18}/></button>
                    <button onClick={() => onManualCorrect(p.id, true)} className={`p-2 rounded ${p.corrected && p.wasCorrect ? 'bg-emerald-600' : 'bg-slate-700'}`}><CheckCircle size={18}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <button onClick={room.status === 'active' ? onReveal : onNext} className={`w-full py-4 rounded-xl font-bold text-lg ${room.status === 'active' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
          {room.status === 'active' ? 'Auflösen' : 'Nächste Frage'}
        </button>
      </div>

      <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 h-fit">
         <h3 className="font-bold mb-4">Status ({answered}/{players.length})</h3>
         <div className="space-y-2">
           {players.map(p => (
             <div key={p.id} className="flex justify-between text-sm items-center">
               <span>{p.name}</span>
               <div className="flex items-center gap-2">
                 {p.currentAnswer ? <CheckCircle size={14} className="text-emerald-400"/> : <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse"/>}
                 <span className="bg-slate-900 px-2 rounded font-mono">{p.score}</span>
               </div>
             </div>
           ))}
         </div>
      </div>
    </div>
  );
}

function PlayerDashboard({ room, player, onAnswer }) {
  if (!player) return null;
  const q = room.questions[room.currentQuestionIndex];
  const [val, setVal] = useState('');

  if (room.status === 'lobby') return <div className="text-center p-10 bg-slate-800 rounded-xl">Warte auf Start...</div>;
  if (room.status === 'finished') return <div className="text-center p-10 bg-slate-800 rounded-xl">Fertig! Score: {player.score}</div>;

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex justify-between text-xs text-indigo-400 font-bold uppercase">
        <span>Frage {room.currentQuestionIndex + 1}</span>
        <span>Dein Score: {player.score}</span>
      </div>
      <h2 className="text-2xl font-bold">{q.q}</h2>

      {room.status === 'active' && !player.currentAnswer && (
        <div className="space-y-3">
          {q.type === 'multiple' && q.options.map((opt, i) => (
            <button key={i} onClick={() => onAnswer(i)} className="w-full bg-slate-800 p-4 rounded-xl text-left hover:bg-indigo-600 border border-slate-700">{opt}</button>
          ))}
          {(q.type === 'text' || q.type === 'estimation') && (
            <div className="space-y-4">
              <input 
                type={q.type === 'estimation' ? 'number' : 'text'} 
                className="w-full bg-slate-800 p-4 rounded-xl border border-slate-700" 
                placeholder={q.type === 'estimation' ? 'Zahl eingeben...' : 'Deine Antwort...'}
                value={val} onChange={e => setVal(e.target.value)}
              />
              <button onClick={() => onAnswer(val)} className="w-full bg-indigo-600 py-3 rounded-lg font-bold">Antwort abschicken</button>
            </div>
          )}
        </div>
      )}

      {player.currentAnswer && room.status === 'active' && (
        <div className="text-center p-8 bg-slate-800 rounded-xl border border-slate-700 animate-pulse">Eingeloggt. Warte auf Auflösung...</div>
      )}

      {room.status === 'revealed' && (
        <div className={`p-8 rounded-xl border-2 text-center ${player.wasCorrect ? 'bg-emerald-500/10 border-emerald-500' : 'bg-red-500/10 border-red-500'}`}>
          <h3 className="text-xl font-bold">{player.wasCorrect ? 'Punkt erhalten!' : 'Kein Punkt'}</h3>
          {q.type === 'estimation' && <p className="text-sm mt-2">Die Antwort war: {q.correctValue}</p>}
        </div>
      )}
    </div>
  );
}