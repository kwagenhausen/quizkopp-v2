import React, { useState, useEffect } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List, Save, FolderOpen, Download, Trash2, Lock } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc, updateDoc, getDocs, query, where } from 'firebase/firestore';

// --- KONFIGURATION ---
const ADMIN_PASSWORD = "KevinQuizkopp"; // HIER DEIN PASSWORT ÄNDERN!

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

const downloadCSV = (players, roomCode) => {
  const headers = ["Platz", "Name", "Punkte"];
  const rows = players.map((p, i) => [i + 1, p.name, p.score]);
  const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ergebnisse_${roomCode}_${new Date().toLocaleDateString()}.csv`;
  link.click();
};

// --- HAUPT-APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [allRooms, setAllRooms] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);

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
    const q = activeRoom.questions[activeRoom.currentQuestionIndex];
    if (q.type === 'multiple') {
      for (const p of playersInRoom) {
        if (p.currentAnswer == q.correctIndex) {
          await updateDoc(doc(db, 'players', p.id), { score: p.score + 1 });
        }
      }
    } else if (q.type === 'estimation') {
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
    await updateDoc(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
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

  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade QuizKopp Pro...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-10 shadow-lg">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Trophy className="text-yellow-400" />
            <h1 className="text-xl font-bold">QuizKopp Pro</h1>
          </div>
          {role && (
            <button onClick={() => { if(role === 'host') deleteDoc(doc(db, 'rooms', currentRoomCode)); setRole(null); setCurrentRoomCode(''); }} className="text-slate-400 hover:text-red-400 flex items-center gap-2">
              <LogOut size={18}/> {role === 'host' ? 'Beenden' : 'Verlassen'}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 py-8">
        {!role && !adminAuthenticated && (
          <ParticipantView onJoin={async (code, name) => {
            const codeUpper = code.toUpperCase();
            if (!allRooms.some(r => r.id === codeUpper)) return alert("Raum nicht gefunden!");
            await setDoc(doc(db, 'players', user.uid), { name, roomCode: codeUpper, score: 0, currentAnswer: null });
            setCurrentRoomCode(codeUpper); setRole('player');
          }} onOpenAdmin={() => setAdminAuthenticated('login')} />
        )}

        {adminAuthenticated === 'login' && !role && (
          <AdminLogin onLogin={(pw) => {
            if(pw === ADMIN_PASSWORD) setAdminAuthenticated(true);
            else alert("Falsches Passwort!");
          }} onCancel={() => setAdminAuthenticated(false)} />
        )}

        {adminAuthenticated === true && !role && (
          <div className="text-center space-y-6 py-10">
            <h2 className="text-3xl font-bold">Quizmaster-Zentrale</h2>
            <div className="grid md:grid-cols-2 gap-4">
               <button onClick={() => setRole('host_setup')} className="bg-emerald-600 p-8 rounded-2xl flex flex-col items-center gap-4 hover:bg-emerald-500 transition-colors">
                  <Plus size={48} />
                  <span className="text-xl font-bold">Neues Quiz erstellen</span>
               </button>
               <button onClick={() => setRole('library')} className="bg-indigo-600 p-8 rounded-2xl flex flex-col items-center gap-4 hover:bg-indigo-500 transition-colors">
                  <FolderOpen size={48} />
                  <span className="text-xl font-bold">Quiz-Bibliothek</span>
               </button>
            </div>
            <button onClick={() => setAdminAuthenticated(false)} className="text-slate-500 underline mt-10">Abmelden</button>
          </div>
        )}

        {role === 'host_setup' && <HostSetup onCreate={createRoom} onCancel={() => setRole(null)} db={db} />}
        {role === 'library' && <QuizLibrary onSelect={(q) => createRoom(q)} onCancel={() => setRole(null)} db={db} />}

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

// --- KOMPONENTEN ---

function ParticipantView({ onJoin, onOpenAdmin }) {
  const [c, setC] = useState('');
  const [n, setN] = useState('');
  return (
    <div className="max-w-md mx-auto space-y-6 pt-10">
      <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl">
        <h2 className="text-2xl font-bold mb-6 text-center">Quiz beitreten</h2>
        <div className="space-y-4">
          <input type="text" placeholder="Raum-Code (z.B. A1B2)" className="w-full bg-slate-900 p-4 rounded-xl text-center font-mono text-2xl tracking-widest border border-slate-700 focus:border-indigo-500 outline-none" value={c} onChange={e => setC(e.target.value)} maxLength={4} />
          <input type="text" placeholder="Dein Teamname" className="w-full bg-slate-900 p-4 rounded-xl border border-slate-700 focus:border-indigo-500 outline-none" value={n} onChange={e => setN(e.target.value)} />
          <button onClick={() => onJoin(c, n)} className="w-full bg-indigo-600 py-4 rounded-xl font-bold text-lg hover:bg-indigo-500 transition-colors shadow-lg">Jetzt mitspielen</button>
        </div>
      </div>
      <div className="flex justify-center">
        <button onClick={onOpenAdmin} className="text-slate-700 hover:text-slate-500 transition-colors text-sm flex items-center gap-1">
          <Lock size={12}/> Admin
        </button>
      </div>
    </div>
  );
}

function AdminLogin({ onLogin, onCancel }) {
  const [pw, setPw] = useState('');
  return (
    <div className="max-w-sm mx-auto bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl pt-10">
      <h2 className="text-xl font-bold mb-6 text-center">Master-Login</h2>
      <input type="password" placeholder="Passwort" className="w-full bg-slate-900 p-3 rounded mb-4 border border-slate-700 outline-none" value={pw} onChange={e => setPw(e.target.value)} onKeyPress={e => e.key === 'Enter' && onLogin(pw)} autoFocus />
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 bg-slate-700 py-2 rounded font-bold">Zurück</button>
        <button onClick={() => onLogin(pw)} className="flex-1 bg-indigo-600 py-2 rounded font-bold">Anmelden</button>
      </div>
    </div>
  );
}

function QuizLibrary({ onSelect, onCancel, db }) {
  const [templates, setTemplates] = useState([]);
  useEffect(() => {
    getDocs(collection(db, 'quiz_templates')).then(s => setTemplates(s.docs.map(d => ({id: d.id, ...d.data()}))));
  }, []);

  const deleteT = async (id) => {
    if(confirm("Quiz wirklich löschen?")) {
      await deleteDoc(doc(db, 'quiz_templates', id));
      setTemplates(templates.filter(t => t.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2"><FolderOpen className="text-indigo-400"/> Gespeicherte Quizzes</h2>
        <button onClick={onCancel} className="text-slate-400">Zurück</button>
      </div>
      <div className="grid gap-3">
        {templates.length === 0 && <p className="text-center py-10 text-slate-500 italic">Noch keine Quizzes gespeichert.</p>}
        {templates.map(t => (
          <div key={t.id} className="bg-slate-800 p-5 rounded-xl border border-slate-700 flex justify-between items-center group">
             <div>
               <h3 className="text-lg font-bold">{t.title}</h3>
               <p className="text-sm text-slate-500">{t.questions.length} Fragen</p>
             </div>
             <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
               <button onClick={() => deleteT(t.id)} className="p-2 text-slate-500 hover:text-red-500"><Trash2 size={20}/></button>
               <button onClick={() => onSelect(t.questions)} className="bg-emerald-600 px-4 py-2 rounded font-bold flex items-center gap-2">Laden <Play size={16}/></button>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HostSetup({ onCreate, onCancel, db }) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState([{ type: 'multiple', q: '', options: ['', '', '', ''], correctIndex: 0, correctValue: '' }]);

  const addQ = () => setQuestions([...questions, { type: 'multiple', q: '', options: ['', '', '', ''], correctIndex: 0, correctValue: '' }]);
  const update = (i, f, v) => { const n = [...questions]; n[i][f] = v; setQuestions(n); };

  const saveToLib = async () => {
    if(!title) return alert("Bitte einen Namen für das Quiz eingeben!");
    await setDoc(doc(collection(db, 'quiz_templates')), { title, questions, createdAt: Date.now() });
    alert("In Bibliothek gespeichert!");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <input type="text" placeholder="Name des Quizzes (z.B. Pubquiz Mai)" className="bg-transparent text-2xl font-bold border-b border-slate-700 focus:border-indigo-500 outline-none pb-1 w-full" value={title} onChange={e => setTitle(e.target.value)} />
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={saveToLib} className="flex-1 bg-slate-800 border border-slate-700 p-2 rounded flex items-center justify-center gap-2 hover:bg-slate-700"><Save size={18}/> Speichern</button>
          <button onClick={onCancel} className="p-2 text-slate-500">Abbrechen</button>
        </div>
      </div>
      
      {questions.map((q, i) => (
        <div key={i} className="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
          <div className="flex gap-4 items-end">
             <div className="flex-1">
               <label className="text-xs text-slate-400 uppercase font-bold">Frage {i+1}</label>
               <input type="text" className="w-full bg-slate-900 p-2 rounded border border-slate-700" value={q.q} onChange={e => update(i, 'q', e.target.value)} />
             </div>
             <div className="w-40">
               <label className="text-xs text-slate-400 uppercase font-bold">Typ</label>
               <select className="w-full bg-slate-900 p-2 rounded border border-slate-700" value={q.type} onChange={e => update(i, 'type', e.target.value)}>
                 <option value="multiple">Multiple Choice</option>
                 <option value="text">Freitext</option>
                 <option value="estimation">Schätzfrage</option>
               </select>
             </div>
          </div>
          {q.type === 'multiple' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className={`flex items-center gap-2 p-2 rounded border ${q.correctIndex == oi ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-900'}`}>
                  <input type="radio" checked={q.correctIndex == oi} onChange={() => update(i, 'correctIndex', oi)} />
                  <input type="text" className="bg-transparent w-full text-sm outline-none" value={opt} onChange={e => { const no = [...q.options]; no[oi] = e.target.value; update(i, 'options', no); }} placeholder="Antwort eingeben..." />
                </div>
              ))}
            </div>
          )}
          {q.type === 'estimation' && <input type="number" className="w-full bg-slate-900 p-2 rounded border border-slate-700" value={q.correctValue} onChange={e => update(i, 'correctValue', e.target.value)} placeholder="Korrekte Zahl..." />}
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={addQ} className="flex-1 bg-slate-800 border border-slate-700 py-3 rounded-xl font-bold hover:bg-slate-700">+ Frage hinzufügen</button>
        <button onClick={() => onCreate(questions)} className="flex-1 bg-emerald-600 py-3 rounded-xl font-bold shadow-lg shadow-emerald-900/20">Quiz jetzt starten</button>
      </div>
    </div>
  );
}

function HostDashboard({ room, players, onStart, onReveal, onNext, onManualCorrect }) {
  const q = room.questions[room.currentQuestionIndex];
  const answered = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== "").length;

  if (room.status === 'lobby') return (
    <div className="text-center space-y-12 py-10">
      <div>
        <p className="text-slate-500 uppercase tracking-widest mb-2">Raum-Code</p>
        <h2 className="text-7xl font-mono font-bold text-indigo-400">{room.id}</h2>
      </div>
      <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-lg mx-auto">
        <h3 className="mb-6 font-bold flex items-center justify-center gap-2 text-xl"><Users /> Teilnehmer ({players.length})</h3>
        <div className="flex flex-wrap gap-2 justify-center">
          {players.map(p => <span key={p.id} className="bg-slate-700 px-4 py-1.5 rounded-full text-sm font-semibold">{p.name}</span>)}
          {players.length === 0 && <p className="text-slate-500 italic">Warte auf Teams...</p>}
        </div>
      </div>
      <button onClick={onStart} disabled={players.length === 0} className="bg-emerald-600 px-16 py-5 rounded-full text-2xl font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-xl shadow-emerald-500/10">Quiz starten!</button>
    </div>
  );

  if (room.status === 'finished') return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-4xl font-bold text-yellow-400 mb-2">Endstand</h2>
        <p className="text-slate-500">Das Quiz ist beendet.</p>
      </div>
      <div className="space-y-3">
        {players.map((p, i) => (
          <div key={p.id} className={`p-5 rounded-2xl flex justify-between items-center border ${i === 0 ? 'bg-yellow-500/10 border-yellow-500 shadow-lg shadow-yellow-500/10' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex items-center gap-4">
              <span className={`text-2xl font-bold ${i === 0 ? 'text-yellow-400' : 'text-slate-500'}`}>{i+1}.</span>
              <span className="text-xl font-bold">{p.name}</span>
            </div>
            <span className="font-mono text-2xl bg-slate-900 px-4 py-1 rounded-lg border border-slate-700">{p.score}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 pt-6">
         <button onClick={() => downloadCSV(players, room.id)} className="flex-1 bg-slate-800 border border-slate-700 py-4 rounded-xl flex items-center justify-center gap-2 font-bold hover:bg-slate-700 transition-colors">
           <Download /> Ergebnisse als Excel (CSV)
         </button>
      </div>
    </div>
  );

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-6">
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 relative overflow-hidden shadow-xl">
          <div className="flex items-center gap-2 text-indigo-400 mb-4 font-bold uppercase text-xs tracking-widest">
            {q.type === 'multiple' ? <List size={14}/> : q.type === 'text' ? <MessageSquare size={14}/> : <Hash size={14}/>}
            {q.type} • Frage {room.currentQuestionIndex + 1}/{room.questions.length}
          </div>
          <h2 className="text-3xl font-bold mb-8 leading-tight">{q.q}</h2>
          {room.status === 'revealed' && (
            <div className="bg-emerald-500/10 border border-emerald-500/50 p-4 rounded-xl mb-6 flex justify-between items-center">
              <div>
                <p className="text-xs text-emerald-500 uppercase font-bold mb-1">Korrekte Lösung</p>
                <p className="text-xl font-bold">{q.type === 'multiple' ? q.options[q.correctIndex] : q.type === 'estimation' ? q.correctValue : 'Manueller Check'}</p>
              </div>
              <CheckCircle className="text-emerald-500" size={32} />
            </div>
          )}
          {room.status === 'revealed' && q.type === 'text' && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Antworten korrigieren:</p>
              {players.map(p => (
                <div key={p.id} className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
                  <div className="pr-4">
                    <span className="text-xs text-indigo-400 font-bold uppercase">{p.name}</span>
                    <p className="font-medium italic text-slate-200">"{p.currentAnswer || '---'}"</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => onManualCorrect(p.id, false)} className={`p-3 rounded-lg transition-colors ${p.corrected && !p.wasCorrect ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-500'}`}><XCircle size={20}/></button>
                    <button onClick={() => onManualCorrect(p.id, true)} className={`p-3 rounded-lg transition-colors ${p.corrected && p.wasCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'}`}><CheckCircle size={20}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={room.status === 'active' ? onReveal : onNext} className={`w-full py-5 rounded-2xl font-bold text-xl transition-all shadow-lg ${room.status === 'active' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
          {room.status === 'active' ? 'Lösung auflösen' : 'Nächste Frage'}
        </button>
      </div>
      <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 h-fit shadow-lg">
         <div className="flex justify-between items-center mb-6">
           <h3 className="font-bold">Live-Ranking</h3>
           <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded font-bold">{answered}/{players.length} bereit</span>
         </div>
         <div className="space-y-3">
           {players.map(p => (
             <div key={p.id} className="flex justify-between text-sm items-center bg-slate-900/50 p-2 rounded-lg">
               <span className="font-semibold">{p.name}</span>
               <div className="flex items-center gap-3">
                 {p.currentAnswer ? <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"/> : <div className="w-2 h-2 rounded-full bg-slate-700 animate-pulse"/>}
                 <span className="font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-indigo-300">{p.score}</span>
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

  if (room.status === 'lobby') return (
    <div className="text-center py-20 bg-slate-800 rounded-3xl border border-slate-700 shadow-xl max-w-sm mx-auto">
      <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-400 animate-pulse">
        <Users size={40} />
      </div>
      <h2 className="text-2xl font-bold mb-2">Team {player.name}</h2>
      <p className="text-slate-500">Du bist im Raum <span className="text-white font-mono">{room.id}</span>.</p>
      <p className="mt-8 text-sm text-indigo-400 animate-bounce">Warte auf den Start...</p>
    </div>
  );

  if (room.status === 'finished') return (
    <div className="text-center py-20 bg-slate-800 rounded-3xl border border-slate-700 shadow-xl max-w-sm mx-auto">
       <Trophy size={64} className="text-yellow-400 mx-auto mb-6" />
       <h2 className="text-2xl font-bold mb-2">Quiz beendet!</h2>
       <p className="text-slate-400 mb-6">Dein Team-Score:</p>
       <div className="text-6xl font-mono font-bold text-white mb-8">{player.score}</div>
       <p className="text-sm text-slate-500 italic">Schau nach vorne zum Endstand.</p>
    </div>
  );

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex justify-between items-center text-xs text-slate-500 font-bold uppercase tracking-widest">
        <span>Frage {room.currentQuestionIndex + 1}</span>
        <span className="bg-slate-800 px-3 py-1 rounded-full border border-slate-700 text-indigo-400">Punkte: {player.score}</span>
      </div>
      <h2 className="text-2xl font-bold leading-tight">{q.q}</h2>

      {room.status === 'active' && !player.currentAnswer && (
        <div className="space-y-3 pt-4">
          {q.type === 'multiple' && q.options.map((opt, i) => (
            <button key={i} onClick={() => onAnswer(i)} className="w-full bg-slate-800 p-5 rounded-2xl text-left hover:bg-indigo-600 border border-slate-700 transition-all active:scale-95 shadow-md font-medium">{opt}</button>
          ))}
          {(q.type === 'text' || q.type === 'estimation') && (
            <div className="space-y-4">
              <input 
                type={q.type === 'estimation' ? 'number' : 'text'} 
                className="w-full bg-slate-800 p-5 rounded-2xl border border-slate-700 text-lg outline-none focus:border-indigo-500 transition-colors" 
                placeholder={q.type === 'estimation' ? 'Zahl eintippen...' : 'Deine Antwort hier...'}
                value={val} onChange={e => setVal(e.target.value)}
                autoFocus
              />
              <button onClick={() => onAnswer(val)} disabled={!val} className="w-full bg-indigo-600 py-4 rounded-2xl font-bold text-lg shadow-lg disabled:opacity-50">Antwort abschicken</button>
            </div>
          )}
        </div>
      )}

      {player.currentAnswer && room.status === 'active' && (
        <div className="text-center py-12 bg-slate-800 rounded-3xl border border-slate-700 shadow-inner">
          <div className="w-12 h-12 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
            <CheckCircle />
          </div>
          <p className="font-bold text-lg mb-1">Eingeloggt!</p>
          <p className="text-slate-500 text-sm italic">Warte auf die Auflösung...</p>
        </div>
      )}

      {room.status === 'revealed' && (
        <div className={`py-12 rounded-3xl border-2 text-center transition-all ${player.wasCorrect ? 'bg-emerald-500/10 border-emerald-500' : 'bg-red-500/10 border-red-500'}`}>
          {player.wasCorrect ? (
            <div className="space-y-2">
              <Trophy size={48} className="mx-auto text-emerald-500 mb-2" />
              <h3 className="text-2xl font-bold text-emerald-500">Punkt für euch!</h3>
              <p className="text-emerald-500/50">Sehr gut kombiniert.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <XCircle size={48} className="mx-auto text-red-500 mb-2" />
              <h3 className="text-2xl font-bold text-red-400">Kein Punkt.</h3>
              <p className="text-red-400/50">Vielleicht bei der nächsten Frage!</p>
            </div>
          )}
          {q.type === 'estimation' && <p className="mt-6 text-sm text-white font-bold bg-slate-900/50 inline-block px-4 py-2 rounded-full border border-white/10">Richtige Antwort: {q.correctValue}</p>}
        </div>
      )}
    </div>
  );
}