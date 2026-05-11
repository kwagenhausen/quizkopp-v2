import React, { useState, useEffect } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List, Save, FolderOpen, Download, Trash2, Lock, Image as ImageIcon, Clock, Bell, Edit3 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';

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

// --- HELFER ---
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';
  for (let i = 0; i < 4; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
};

const downloadCSV = (players, room) => {
  const headers = ["Platz", "Name", "Team", "Gesamtpunkte"];
  room.questions.forEach((q, i) => headers.push(`F${i+1}: ${q.q.replace(/,/g, "")}`));
  
  const rows = players.map((p, i) => {
    const row = [i + 1, p.name, p.team || "-", p.score];
    room.questions.forEach((q, qi) => {
      const a = p.answers?.[qi];
      if (q.type === 'multiple' && a !== undefined && a !== "") row.push(q.options[a]?.replace(/,/g, "") || "---");
      else if (q.type === 'buzzer') row.push(a ? "Gebuzzert & Richtig" : "---");
      else row.push(a?.toString().replace(/,/g, "") || "---");
    });
    return row;
  });

  const csv = "\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `Quizkopp_Export_${room.id}.csv`; a.click();
};

// --- HAUPT-APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [allRooms, setAllRooms] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [adminAuth, setAdminAuth] = useState(false);
  
  const [editingQuiz, setEditingQuiz] = useState(null); 

  useEffect(() => {
    signInAnonymously(auth);
    return onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubR = onSnapshot(collection(db, 'rooms'), s => setAllRooms(s.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubP = onSnapshot(collection(db, 'players'), s => setAllPlayers(s.docs.map(d => ({id: d.id, ...d.data()}))));
    return () => { unsubR(); unsubP(); };
  }, [user]);

  const activeRoom = allRooms.find(r => r.id === currentRoomCode);
  const players = allPlayers.filter(p => p.roomCode === currentRoomCode).sort((a,b) => b.score - a.score);
  const myProfile = allPlayers.find(p => p.id === user?.uid);

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

  const createRoom = async (questions) => {
    const code = generateRoomCode();
    await setDoc(doc(db, 'rooms', code), {
      hostId: user.uid, status: 'lobby', currentQuestionIndex: 0, questions,
      timeLeft: questions[0].timer || 0, buzzerWinner: null, buzzerLockedOut: [], createdAt: Date.now()
    });
    setCurrentRoomCode(code); setRole('host');
  };

  const manualCorrect = async (pId, ok) => {
    const p = players.find(x => x.id === pId);
    await updateDoc(doc(db, 'players', pId), { score: ok ? p.score + 1 : p.score, corrected: true, wasCorrect: ok });
  };

  const handleBuzzerHost = async (isCorrect) => {
    const pId = activeRoom.buzzerWinner;
    const batch = writeBatch(db);
    
    if (isCorrect) {
      for (const player of players) {
        const isWinner = player.id === pId;
        batch.update(doc(db, 'players', player.id), { 
            score: isWinner ? player.score + 1 : player.score, 
            wasCorrect: isWinner,
            ...(isWinner ? {[`answers.${activeRoom.currentQuestionIndex}`]: true} : {})
        });
      }
      batch.update(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
    } else {
      const locked = activeRoom.buzzerLockedOut || [];
      batch.update(doc(db, 'rooms', currentRoomCode), { buzzerWinner: null, buzzerLockedOut: [...locked, pId] });
    }
    await batch.commit();
  };

  // --- DIE NEUE TEAM-SCHÄTZ-LOGIK ---
  const revealAnswer = async () => {
    if(!activeRoom) return;
    const q = activeRoom.questions[activeRoom.currentQuestionIndex];
    const batch = writeBatch(db);
    
    if (q.type === 'multiple') {
      for (const p of players) {
        const hasAnswered = p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "";
        const isCorrect = hasAnswered && (p.currentAnswer == q.correctIndex);
        batch.update(doc(db, 'players', p.id), { score: isCorrect ? p.score + 1 : p.score, wasCorrect: isCorrect });
      }
    } else if (q.type === 'estimation') {
      const validPlayers = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "");
      if (validPlayers.length > 0) {
        const target = parseFloat(q.correctValue);
        
        // 1. Sammle und gruppiere alle Antworten nach Team
        const teams = {};
        for (const p of validPlayers) {
          // Falls kein Teamname existiert, bilde ein 1-Mann-Team anhand der ID
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.id;
          if (!teams[tId]) teams[tId] = { sum: 0, count: 0 };
          teams[tId].sum += parseFloat(p.currentAnswer);
          teams[tId].count++;
        }
        
        // 2. Berechne den Durchschnitt pro Team und finde die kleinste Differenz
        let minDiff = Infinity;
        const teamDiffs = {};
        for (const tId in teams) {
          const avg = teams[tId].sum / teams[tId].count;
          const diff = Math.abs(avg - target);
          teamDiffs[tId] = diff;
          if (diff < minDiff) minDiff = diff;
        }
        
        // 3. Vergib die Punkte an alle Spieler der Sieger-Teams
        for (const p of players) {
          const hasAnswered = p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "";
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.id;
          const isCorrect = hasAnswered && (teamDiffs[tId] === minDiff);
          batch.update(doc(db, 'players', p.id), { score: isCorrect ? p.score + 1 : p.score, wasCorrect: isCorrect });
        }
      } else {
         for (const p of players) batch.update(doc(db, 'players', p.id), { wasCorrect: false });
      }
    }
    batch.update(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
    await batch.commit();
  };

  if (loading) return <div className="min-h-screen bg-[#F0F9FF] flex items-center justify-center text-[#1E293B] font-bold">Lade Quizkopp...</div>;

  return (
    <div className="min-h-screen bg-[#F0F9FF] text-[#1E293B] font-sans">
      <header className="bg-white border-b border-sky-100 p-4 sticky top-0 z-10 shadow-sm">
        <div className={role === 'host' ? "w-full max-w-[1920px] mx-auto px-4 flex justify-between items-center" : "max-w-4xl mx-auto flex justify-between items-center"}>
          <div className="flex items-center gap-2"><Trophy className="text-[#E69F00]"/><h1 className="text-xl font-bold italic">Die Quizkopp App</h1></div>
          {role && <button onClick={() => { if(role==='host') deleteDoc(doc(db,'rooms',currentRoomCode)); setRole(null); setCurrentRoomCode(''); }} className="text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20}/></button>}
        </div>
      </header>

      <main className={role === 'host' ? "w-full max-w-[1920px] mx-auto p-4 lg:p-8 relative" : "max-w-4xl mx-auto p-4 py-8 relative"}>
        {!role && !adminAuth && <LoginView onJoin={async (c, n, t) => {
            if(!allRooms.find(r=>r.id===c.toUpperCase())) return alert("Raum nicht gefunden!");
            // Das Team wird jetzt mit in die Datenbank geschrieben
            await setDoc(doc(db,'players',user.uid),{name:n, team:t, roomCode:c.toUpperCase(),score:0,currentAnswer:null,answers:{}});
            setCurrentRoomCode(c.toUpperCase()); setRole('player');
        }} onAdmin={() => setAdminAuth('login')}/>}

        {adminAuth === 'login' && <AdminLogin onOk={pw => pw === ADMIN_PASSWORD ? setAdminAuth(true) : alert("Falsch!")} onBack={() => setAdminAuth(false)}/>}
        
        {adminAuth === true && !role && <AdminPanel onNew={() => { setEditingQuiz(null); setRole('setup'); }} onLib={() => setRole('lib')} onLogout={() => setAdminAuth(false)}/>}
        
        {role === 'setup' && <HostSetup onCreate={createRoom} onBack={() => setRole(null)} db={db} initialQuiz={editingQuiz} />}
        
        {role === 'lib' && <Library onSelect={q => createRoom(q)} onEdit={quiz => { setEditingQuiz(quiz); setRole('setup'); }} onBack={() => setRole(null)} db={db}/>}

        {role === 'host' && activeRoom && <HostDashboard room={activeRoom} players={players} onReveal={revealAnswer} onNext={async () => {
            const last = activeRoom.currentQuestionIndex >= activeRoom.questions.length -1;
            const nextIdx = activeRoom.currentQuestionIndex + 1;
            const batch = writeBatch(db);
            
            for(const p of players) {
              batch.update(doc(db,'players',p.id),{currentAnswer:null,corrected:false, wasCorrect:null});
            }
            batch.update(doc(db,'rooms',currentRoomCode),{
              status:last?'finished':'active',
              currentQuestionIndex:last?activeRoom.currentQuestionIndex:nextIdx,
              timeLeft:activeRoom.questions[nextIdx]?.timer || 0, 
              buzzerWinner: null, 
              buzzerReaction: null, // Reaktionszeit für die nächste Frage zurücksetzen
              buzzerLockedOut: []
            });
            await batch.commit();
        }} onCorrect={manualCorrect} onBuzzerCorrect={handleBuzzerHost}/>}

        {role === 'player' && activeRoom && <PlayerDashboard room={activeRoom} player={myProfile} players={players} onAnswer={async v => {
            await updateDoc(doc(db,'players',user.uid),{currentAnswer:v,[`answers.${activeRoom.currentQuestionIndex}`]:v});
        }} onBuzz={async (reactionTime) => {
            // Die Zeit wird übergeben und gespeichert!
            if(!activeRoom.buzzerWinner && !(activeRoom.buzzerLockedOut || []).includes(user.uid)) {
              await updateDoc(doc(db,'rooms',currentRoomCode),{buzzerWinner: user.uid, buzzerWinnerName: myProfile.name, buzzerReaction: reactionTime});
            }
        }}/>}
      </main>
    </div>
  );
}

function LoginView({ onJoin, onAdmin }) {
  const [c, setC] = useState(''); 
  const [n, setN] = useState('');
  const [t, setT] = useState(''); // Das neue Team-Feld
  
  return (
    <div className="max-w-md mx-auto pt-10 text-center">
      <img src="/logo.png" alt="Quizkopp Logo" className="w-64 h-auto mx-auto mb-10 drop-shadow-md transition-transform hover:scale-105" />
      <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl space-y-4">
        <input placeholder="RAUM-CODE" className="w-full bg-slate-50 p-4 rounded-xl text-center text-2xl font-mono border border-sky-100 outline-none focus:border-[#E69F00]" value={c} onChange={e=>setC(e.target.value.toUpperCase())} maxLength={4}/>
        <input placeholder="DEIN NAME" className="w-full bg-slate-50 p-4 rounded-xl border border-sky-100 outline-none focus:border-[#E69F00]" value={n} onChange={e=>setN(e.target.value)}/>
        <input placeholder="TEAMNAME (OPTIONAL)" className="w-full bg-slate-50 p-4 rounded-xl border border-sky-100 outline-none focus:border-[#E69F00]" value={t} onChange={e=>setT(e.target.value)}/>
        
        <button onClick={() => onJoin(c, n, t)} disabled={!c || !n} className="w-full bg-[#E69F00] text-white py-4 rounded-xl font-bold text-lg hover:bg-[#D49100] transition-colors shadow-md disabled:opacity-50">Jetzt beitreten</button>
      </div>
      <button onClick={onAdmin} className="mt-20 text-slate-300 hover:text-slate-500 text-xs">Admin-Zentrale</button>
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
  useEffect(() => { getDocs(collection(db,'quiz_templates')).then(s=>setT(s.docs.map(d=>({id:d.id,...d.data()})))); }, []);
  const deleteQuiz = async (id) => { if(window.confirm("Bist du sicher?")) { await deleteDoc(doc(db, 'quiz_templates', id)); setT(t.filter(q => q.id !== id)); } };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><h2 className="text-2xl font-bold">Deine Quizzes</h2><button onClick={onBack} className="text-slate-400">Zurück</button></div>
      {t.map(x => (
        <div key={x.id} className="bg-white p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-sky-50 shadow-sm">
          <div><p className="font-bold text-xl">{x.title}</p><p className="text-sm text-slate-400">{x.questions?.length || 0} Fragen</p></div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button onClick={() => onEdit(x)} className="p-3 text-slate-400 hover:text-[#E69F00] bg-slate-50 rounded-lg" title="Quiz bearbeiten"><Edit3 size={20}/></button>
            <button onClick={() => deleteQuiz(x.id)} className="p-3 text-slate-400 hover:text-red-500 bg-slate-50 rounded-lg" title="Quiz löschen"><Trash2 size={20}/></button>
            <button onClick={() => onSelect(x.questions)} className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold ml-auto sm:ml-2 shadow-md w-full sm:w-auto">Spielen</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function HostSetup({ onCreate, onBack, db, initialQuiz }) {
  const [title, setTitle] = useState(initialQuiz ? initialQuiz.title : '');
  const [qs, setQs] = useState(initialQuiz ? initialQuiz.questions : [{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:0,imgUrl:'',showImg:true}]);
  
  const update = (i,f,v) => { const n=[...qs]; n[i][f]=v; setQs(n); };
  
  const removeQ = (index) => {
    if (qs.length === 1) return alert("Ein Quiz braucht mindestens eine Frage!");
    if(window.confirm("Frage wirklich löschen?")) {
      const n = [...qs];
      n.splice(index, 1);
      setQs(n);
    }
  };

  const saveToLib = async () => {
    if(!title) return alert("Titel fehlt!");
    if (initialQuiz && initialQuiz.id) {
      await updateDoc(doc(db, 'quiz_templates', initialQuiz.id), { title, questions: qs });
      alert("Quiz erfolgreich aktualisiert!");
    } else {
      await setDoc(doc(collection(db,'quiz_templates')), { title, questions: qs, createdAt: Date.now() });
      alert("Quiz neu gespeichert!");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <input placeholder="Quiz-Name" className="bg-transparent text-2xl font-bold border-b border-sky-200 w-full outline-none" value={title} onChange={e=>setTitle(e.target.value)}/>
        <button onClick={saveToLib} className="bg-white p-2 rounded border border-sky-100 shadow-sm flex items-center gap-2 text-slate-600 font-bold hover:bg-slate-50 transition-colors">
            <Save size={20} className="text-[#E69F00]"/> {initialQuiz ? 'Aktualisieren' : 'Speichern'}
        </button>
      </div>
      {qs.map((q,i) => (
        <div key={i} className="bg-white p-6 rounded-3xl border border-sky-100 shadow-md space-y-4">
          <div className="flex gap-4">
            <input placeholder="Frage..." className="flex-1 bg-slate-50 p-2 rounded border border-sky-50" value={q.q} onChange={e=>update(i,'q',e.target.value)}/>
            <select className="bg-slate-50 p-2 rounded border border-sky-50 text-slate-700" value={q.type} onChange={e=>update(i,'type',e.target.value)}>
              <option value="multiple">Multiple Choice</option><option value="text">Freitext</option><option value="estimation">Schätzung</option><option value="buzzer">Buzzer-Frage</option>
            </select>
            <button onClick={() => removeQ(i)} className="p-2 bg-red-50 text-red-400 hover:bg-red-500 hover:text-white rounded border border-red-100 transition-colors" title="Frage löschen"><Trash2 size={20}/></button>
          </div>
          <div className="flex gap-4 items-center flex-wrap">
            <input placeholder="Bild-URL (optional)" className="flex-1 min-w-[200px] bg-slate-50 p-2 rounded border border-sky-50 text-xs" value={q.imgUrl} onChange={e=>update(i,'imgUrl',e.target.value)}/>
            <div className="flex items-center gap-2 text-xs text-slate-400"><label>Auf Handy?</label><input type="checkbox" checked={q.showImg} onChange={e=>update(i,'showImg',e.target.checked)}/></div>
            {q.type !== 'buzzer' && (
              <div className="flex items-center gap-2 ml-auto">
                <Clock size={16} className="text-[#E69F00]"/><input type="number" min="0" className="w-16 bg-slate-50 p-2 rounded border border-sky-50" value={q.timer} onChange={e=>update(i,'timer',parseInt(e.target.value) || 0)}/>
              </div>
            )}
          </div>
          {q.type==='multiple' && <div className="grid grid-cols-2 gap-2">{q.options.map((o,oi)=>(
            <div key={oi} className={`flex gap-2 p-2 rounded border ${q.correctIndex == oi ? 'border-emerald-200 bg-emerald-50' : 'bg-slate-50 border-sky-50'}`}><input type="radio" checked={q.correctIndex==oi} onChange={()=>update(i,'correctIndex',oi)}/><input className="bg-transparent w-full" value={o} onChange={e=>{const no=[...q.options];no[oi]=e.target.value;update(i,'options',no)}}/></div>
          ))}</div>}
          
          {q.type !== 'multiple' && (
            <input type={q.type==='estimation'?'number':'text'} className="w-full bg-slate-50 p-2 rounded border border-sky-50 text-slate-700" value={q.correctValue} onChange={e=>update(i,'correctValue',e.target.value)} placeholder={q.type === 'estimation' ? "Korrekte Zahl..." : "Korrekte Lösung (für dich zur Info)..."} />
          )}
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={()=>setQs([...qs,{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:0,imgUrl:'',showImg:true}])} className="flex-1 bg-white py-3 rounded-2xl border border-sky-100 font-bold shadow-sm text-slate-500">+ Frage hinzufügen</button>
        <button onClick={()=>onCreate(qs)} className="flex-1 bg-emerald-500 text-white py-3 rounded-2xl font-bold shadow-lg">Quiz starten</button>
      </div>
    </div>
  );
}

function HostDashboard({ room, players, onReveal, onNext, onCorrect, onBuzzerCorrect }) {
  const q = room.questions[room.currentQuestionIndex];
  const isLastQuestion = room.currentQuestionIndex >= room.questions.length - 1;

  if (room.status === 'lobby') return (
    <div className="text-center py-20 space-y-12 relative h-full">
      <p className="text-3xl text-slate-400 uppercase tracking-widest font-bold">Raum-Code</p>
      <h2 className="text-[10rem] leading-none font-mono font-bold text-[#E69F00] tracking-widest">{room.id}</h2>
      <div className="bg-white p-8 rounded-3xl border border-sky-100 max-w-4xl mx-auto shadow-xl">
        <h3 className="mb-8 font-bold flex items-center justify-center gap-3 text-3xl text-slate-700"><Users size={36}/> Teilnehmer ({players.length})</h3>
        <div className="flex flex-wrap gap-4 justify-center">
          {players.map(p=>(
            <span key={p.id} className="bg-slate-50 px-6 py-3 rounded-full text-xl font-semibold shadow-sm text-slate-600">
              {p.name} {p.team && <span className="text-sm font-normal text-slate-400 ml-1">({p.team})</span>}
            </span>
          ))}
        </div>
      </div>
      <button onClick={()=>updateDoc(doc(db,'rooms',room.id),{status:'active'})} disabled={players.length===0} className="bg-emerald-500 text-white px-24 py-8 rounded-full text-4xl font-bold shadow-xl transition-all mt-10">Quiz starten!</button>
    </div>
  );
  
  if (room.status === 'finished') return (
    <div className="space-y-8 max-w-4xl mx-auto py-10 text-slate-700 relative h-full">
      <h2 className="text-center text-6xl text-[#E69F00] font-bold mb-12">🏆 Endstand</h2>
      {players.map((p,i)=>(
        <div key={p.id} className={`p-8 rounded-3xl flex justify-between items-center border ${i===0?'bg-yellow-50 border-[#E69F00] shadow-md':'bg-white border-sky-50 shadow-sm'}`}>
          <div>
            <span className="text-3xl font-bold block">{i+1}. {p.name}</span>
            {p.team && <span className="text-lg text-slate-400">Team: {p.team}</span>}
          </div>
          <span className="font-mono text-4xl bg-slate-50 px-6 py-2 rounded-xl text-[#E69F00]">{p.score}</span>
        </div>
      ))}
      <button onClick={()=>downloadCSV(players,room)} className="w-full bg-white border border-sky-100 py-6 rounded-3xl flex items-center justify-center gap-4 text-2xl font-bold mt-12 shadow-md text-slate-700"><Download size={32}/> Excel-Export (CSV)</button>
    </div>
  );

  return (
    <>
      <div className="grid lg:grid-cols-4 gap-8 h-full">
        <div className="lg:col-span-3 space-y-6 flex flex-col h-full text-slate-700">
          <div className="bg-white p-8 md:p-12 rounded-3xl border border-sky-100 shadow-2xl relative flex-grow flex flex-col">
            <div className="flex justify-between items-center mb-8">
               <span className="text-lg font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-sky-50">Frage {room.currentQuestionIndex+1}/{room.questions.length}</span>
               {q.type !== 'buzzer' && <div className="flex items-center gap-3 text-[#E69F00] font-mono text-4xl font-bold bg-slate-50 px-6 py-2 rounded-full border border-sky-50"><Clock size={32}/> {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}</div>}
               {q.type === 'buzzer' && <div className="flex items-center gap-3 text-red-500 font-bold uppercase text-2xl bg-red-50 px-6 py-2 rounded-full text-red-600 animate-pulse"><Bell size={28}/> Buzzer aktiv</div>}
            </div>
            {q.imgUrl && <img src={q.imgUrl} className="w-full max-h-[45vh] object-contain rounded-2xl mb-8 bg-slate-50 p-4 border border-sky-50"/>}
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-10 leading-tight">{q.q}</h2>

            {q.type === 'buzzer' && room.status === 'active' && room.buzzerWinner && (
              <div className="bg-red-50 border-2 border-red-500 p-12 rounded-3xl text-center shadow-2xl animate-pulse mt-auto">
                <p className="text-red-500 font-bold text-xl mb-4 uppercase tracking-widest">Schnellster Buzzer:</p>
                <h3 className="text-6xl md:text-7xl font-black text-slate-800 mb-2">{room.buzzerWinnerName}</h3>
                
                {/* ANZEIGE DER REAKTIONSZEIT */}
                {room.buzzerReaction && (
                    <p className="text-2xl font-bold text-red-500 mb-8 flex items-center justify-center gap-2">
                        <Clock size={24}/> {(room.buzzerReaction / 1000).toFixed(2)} Sekunden
                    </p>
                )}

                <div className="flex gap-6 justify-center">
                  <button onClick={()=>onBuzzerCorrect(false)} className="bg-white border border-red-200 text-red-500 hover:bg-red-500 hover:text-white px-8 py-5 rounded-2xl font-bold text-xl flex items-center gap-3 transition-colors"><XCircle size={28}/> Falsch</button>
                  <button onClick={()=>onBuzzerCorrect(true)} className="bg-emerald-500 text-white px-8 py-5 rounded-2xl font-bold text-xl flex items-center gap-3"><CheckCircle size={28}/> Richtig</button>
                </div>
              </div>
            )}

            {room.status === 'revealed' && q.type !== 'buzzer' && (
              <div className="bg-emerald-50 border border-emerald-500/50 p-8 rounded-2xl mb-6 mt-auto">
                <p className="text-emerald-500 font-bold uppercase tracking-widest mb-2">Korrekte Lösung</p>
                <p className="text-4xl font-bold">
                  {q.type === 'multiple' ? q.options[q.correctIndex] : q.correctValue || "Manuelle Auswertung"}
                </p>
              </div>
            )}
            
            {room.status === 'revealed' && q.type === 'text' && <div className="space-y-4 mt-auto">{players.map(p=>(
              <div key={p.id} className="flex justify-between items-center bg-slate-50 p-6 rounded-2xl border border-sky-50 shadow-sm">
                <div className="pr-4">
                    <span className="text-sm font-bold text-slate-400 uppercase">{p.name}</span>
                    {p.team && <span className="text-xs text-slate-400 ml-2">({p.team})</span>}
                    <p className="text-2xl italic mt-1">"{p.currentAnswer||'---'}"</p>
                </div>
                <div className="flex gap-3"><button onClick={()=>onCorrect(p.id,false)} className={`p-4 rounded-xl shadow-sm ${p.corrected&&!p.wasCorrect?'bg-red-500 text-white':'bg-white text-slate-300 hover:text-red-500'}`}><XCircle size={32}/></button><button onClick={()=>onCorrect(p.id,true)} className={`p-4 rounded-xl shadow-sm ${p.corrected&&p.wasCorrect?'bg-emerald-500 text-white':'bg-white text-slate-300 hover:text-emerald-500'}`}><CheckCircle size={32}/></button></div>
              </div>
            ))}</div>}
          </div>

          {(q.type !== 'buzzer' || room.status === 'revealed') && (
            <button onClick={room.status === 'active' ? onReveal : onNext} className={`w-full py-8 rounded-3xl font-bold text-3xl shadow-xl transition-all hover:scale-[1.02] ${room.status === 'active' ? 'bg-[#E69F00] text-white' : 'bg-emerald-500 text-white'}`}>
              {room.status === 'active' ? 'Lösung' : (isLastQuestion ? 'Ergebnisse anzeigen' : 'Nächste Frage')}
            </button>
          )}
        </div>
        <div className="bg-white p-8 rounded-3xl border border-sky-100 h-fit sticky top-24 shadow-xl">
          <h3 className="text-2xl font-bold mb-8 uppercase tracking-widest text-slate-300">Ranking</h3>
          <div className="space-y-4">{players.map((p, index)=>(
              <div key={p.id} className="flex justify-between text-lg items-center bg-slate-50 p-4 rounded-xl border border-sky-50 shadow-sm">
                <span className="font-bold flex items-center gap-3 text-slate-700">
                    <span className="text-slate-400 text-sm">{index + 1}.</span> 
                    <div>{p.name} {p.team && <div className="text-xs font-normal text-slate-400">{p.team}</div>}</div>
                </span>
                <div className="flex items-center gap-4">{((p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "") || p.id === room.buzzerWinner) ? <CheckCircle size={20} className="text-emerald-500"/> : <div className="w-3 h-3 rounded-full bg-slate-200 animate-pulse mt-1"/>}<span className="font-mono font-bold bg-white px-3 py-1 rounded-lg border border-sky-50 text-[#E69F00] shadow-inner">{p.score}</span></div>
              </div>
            ))}</div>
        </div>
      </div>

      <div className="fixed bottom-6 right-6 bg-white px-6 py-3 rounded-2xl shadow-2xl border border-sky-100 flex items-center gap-3 z-50">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Raum-Code</span>
        <span className="font-mono text-2xl font-bold text-[#E69F00]">{room.id}</span>
      </div>
    </>
  );
}

function PlayerDashboard({ room, player, players, onAnswer, onBuzz }) {
  if (!player) return null;
  const q = room.questions[room.currentQuestionIndex];
  
  const [v, setV] = useState('');
  // NEU: Lokale Stoppuhr, um die Latenzzeit perfekt zu berechnen
  const [qStartTime, setQStartTime] = useState(Date.now());
  
  useEffect(() => {
    setV('');
    setQStartTime(Date.now()); // Stoppuhr startet neu, wenn eine neue Frage geladen wird
  }, [room.currentQuestionIndex]);
  
  const hasAnswered = player.currentAnswer !== null && player.currentAnswer !== undefined && player.currentAnswer !== "";
  const isLockedOut = (room.buzzerLockedOut || []).includes(player.id);

  const timeIsUp = q.timer > 0 && room.timeLeft === 0 && room.status === 'active';

  // HILFSFUNKTION FÜR DEN SOUND & BUZZER
  const handleBuzzClick = () => {
    // 1. Spiele Sound ab
    try {
        const audio = new Audio('/buzzer.mp3');
        audio.play().catch(e => console.log("Sound konnte nicht abgespielt werden:", e));
    } catch(err) { /* Ignoriere Fehler bei alten Browsern */ }
    
    // 2. Berechne Zeit und funke an Host
    const reactionTimeMs = Date.now() - qStartTime;
    onBuzz(reactionTimeMs);
  };

  if (room.status === 'lobby') return <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700"><h2 className="text-2xl font-bold">Hallo {player.name}!</h2><p className="mt-8 animate-pulse text-[#E69F00]">Warte auf Start...</p></div>;
  
  if (room.status === 'finished') {
    const myRank = players.findIndex(p => p.id === player.id) + 1;
    return (
      <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700">
        <Trophy size={64} className="mx-auto text-[#E69F00] mb-6"/>
        <h2 className="text-2xl font-bold mb-2">Quiz beendet!</h2>
        <div className="text-6xl font-bold mb-2">{player.score} <span className="text-2xl text-slate-400">Pkt.</span></div>
        <div className="text-xl font-bold text-emerald-500 bg-emerald-50 inline-block px-4 py-2 rounded-full border border-emerald-100 mt-4">Dein Platz: {myRank}</div>
      </div>
    );
  }
  
  if (q.type === 'buzzer') {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center text-slate-700">
        <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest mb-6"><span>Frage {room.currentQuestionIndex+1}</span><span className="text-[#E69F00]">Score: {player.score}</span></div>
        {q.imgUrl && q.showImg && <img src={q.imgUrl} className="w-full h-40 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 mb-6"/>}
        <h2 className="text-2xl font-bold mb-10">{q.q}</h2>
        
        {room.status === 'active' && !room.buzzerWinner && !isLockedOut && (
            <button onClick={handleBuzzClick} className="w-64 h-64 rounded-full bg-red-600 border-8 border-red-800 shadow-[0_10px_0_#7f1d1d,0_0_50px_rgba(220,38,38,0.3)] active:translate-y-[10px] active:shadow-none transition-all mx-auto flex items-center justify-center">
                <span className="text-4xl font-black text-white">BUZZER</span>
            </button>
        )}
        
        {room.status === 'active' && room.buzzerWinner && room.buzzerWinner === player.id && <div className="py-12 bg-red-50 rounded-3xl border-2 border-red-500 animate-pulse text-3xl font-bold text-red-500">DU BIST DRAN!</div>}
        {room.status === 'revealed' && typeof player.wasCorrect === 'boolean' && <div className={`py-12 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-50 border-emerald-500 text-emerald-500':'bg-slate-50 border-sky-100 text-slate-400'}`}><h3 className="text-2xl font-bold">{player.wasCorrect?'Punkt!':'Vorbei'}</h3></div>}
      </div>
    );
  }
  
  return (
    <div className="max-w-md mx-auto space-y-6 text-slate-700">
      <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest"><span>Frage {room.currentQuestionIndex+1}</span><span className="flex items-center gap-1 text-[#E69F00]"><Clock size={12}/> {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}</span></div>
      <h2 className="text-2xl font-bold leading-tight">{q.q}</h2>
      {q.imgUrl && q.showImg && <img src={q.imgUrl} className="w-full h-48 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 shadow-sm"/>}
      
      {room.status === 'active' && !hasAnswered && !timeIsUp && (
        <div className="space-y-3 pt-4">
          {q.type === 'multiple' && q.options.map((o,i)=><button key={i} onClick={()=>onAnswer(i)} className="w-full bg-white p-5 rounded-2xl text-left border border-sky-100 shadow-sm font-medium active:bg-sky-50 active:scale-[0.98] transition-all">{o}</button>)}
          {(q.type === 'text' || q.type === 'estimation') && <div className="space-y-4"><input type={q.type==='estimation'?'number':'text'} className="w-full bg-slate-50 p-5 rounded-2xl border border-sky-100 outline-none focus:border-[#E69F00]" value={v} onChange={e=>setV(e.target.value)} placeholder="Antwort..."/><button onClick={()=>onAnswer(v)} disabled={!v} className="w-full bg-[#E69F00] text-white py-4 rounded-2xl font-bold shadow-md disabled:opacity-50">Abschicken</button></div>}
        </div>
      )}

      {room.status === 'active' && !hasAnswered && timeIsUp && (
        <div className="text-center py-12 bg-white rounded-3xl border border-sky-100 shadow-inner text-red-500 font-bold text-lg flex flex-col items-center gap-2">
           <Clock size={32}/> Zeit abgelaufen!
           <span className="text-sm text-slate-400 mt-2 font-normal">Warte auf Auflösung...</span>
        </div>
      )}
      
      {hasAnswered && room.status === 'active' && <div className="text-center py-12 bg-white rounded-3xl border border-sky-100 shadow-inner text-[#E69F00] font-bold text-lg flex flex-col items-center gap-2"><CheckCircle size={32}/> Antwort eingeloggt!</div>}
      
      {room.status === 'revealed' && q.type === 'text' && !player.corrected && (
          <div className="py-12 rounded-3xl border-2 text-center bg-slate-50 border-sky-100 text-slate-400 shadow-inner animate-pulse">
             <h3 className="text-xl font-bold">Quizmaster wertet aus...</h3>
             <p className="text-sm mt-2">Warte auf die Entscheidung.</p>
          </div>
      )}
      
      {room.status === 'revealed' && (q.type !== 'text' || player.corrected) && typeof player.wasCorrect === 'boolean' && (
         <div className={`py-12 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-50 border-emerald-500 text-emerald-500':'bg-red-50 border-red-500 text-red-500'}`}>
             <h3 className="text-2xl font-bold">{player.wasCorrect?'Punkt für dich!':'Leider kein Punkt.'}</h3>
             {q.type === 'estimation' && <p className="mt-2 text-sm text-slate-600 font-bold bg-white inline-block px-4 py-1 rounded-full border border-slate-200">Lösung: {q.correctValue}</p>}
         </div>
      )}
    </div>
  );
}