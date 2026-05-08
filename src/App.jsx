import React, { useState, useEffect } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List, Save, FolderOpen, Download, Trash2, Lock, Image as ImageIcon, Clock, Bell, Edit3 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';

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
  const headers = ["Platz", "Name", "Gesamtpunkte"];
  room.questions.forEach((q, i) => headers.push(`F${i+1}: ${q.q.replace(/,/g, "")}`));
  
  const rows = players.map((p, i) => {
    const row = [i + 1, p.name, p.score];
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

// --- APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [allRooms, setAllRooms] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [adminAuth, setAdminAuth] = useState(false);

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
        if (newTime <= 0) await updateDoc(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
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
    if (isCorrect) {
      const p = players.find(x => x.id === pId);
      await updateDoc(doc(db, 'players', pId), { score: p.score + 1, [`answers.${activeRoom.currentQuestionIndex}`]: true });
      await updateDoc(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
    } else {
      const locked = activeRoom.buzzerLockedOut || [];
      await updateDoc(doc(db, 'rooms', currentRoomCode), { buzzerWinner: null, buzzerLockedOut: [...locked, pId] });
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Lade QuizKopp Pro...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-10">
        <div className={role === 'host' ? "w-full max-w-[1920px] mx-auto px-4 flex justify-between items-center" : "max-w-4xl mx-auto flex justify-between items-center"}>
          <div className="flex items-center gap-2">
            <Trophy className="text-yellow-400"/>
            <h1 className="text-xl font-bold italic">Die Quizkopp App</h1>
          </div>
          {role && <button onClick={() => { if(role==='host') deleteDoc(doc(db,'rooms',currentRoomCode)); setRole(null); setCurrentRoomCode(''); }} className="text-slate-400 hover:text-red-400 transition-colors"><LogOut size={20}/></button>}
        </div>
      </header>

      <main className={role === 'host' ? "w-full max-w-[1920px] mx-auto p-4 lg:p-8" : "max-w-4xl mx-auto p-4 py-8"}>
        {!role && !adminAuth && <LoginView onJoin={async (c, n) => {
            if(!allRooms.find(r=>r.id===c.toUpperCase())) return alert("Raum nicht gefunden!");
            await setDoc(doc(db,'players',user.uid),{name:n,roomCode:c.toUpperCase(),score:0,currentAnswer:null,answers:{}});
            setCurrentRoomCode(c.toUpperCase()); setRole('player');
        }} onAdmin={() => setAdminAuth('login')}/>}

        {adminAuth === 'login' && <AdminLogin onOk={pw => pw === ADMIN_PASSWORD ? setAdminAuth(true) : alert("Falsch!")} onBack={() => setAdminAuth(false)}/>}
        {adminAuth === true && !role && <AdminPanel onNew={() => setRole('setup')} onLib={() => setRole('lib')} onLogout={() => setAdminAuth(false)}/>}
        {role === 'setup' && <HostSetup onCreate={createRoom} onBack={() => setRole(null)} db={db}/>}
        {role === 'lib' && <Library onSelect={q => createRoom(q)} onBack={() => setRole(null)} db={db}/>}

        {role === 'host' && activeRoom && <HostDashboard room={activeRoom} players={players} onReveal={async () => updateDoc(doc(db,'rooms',currentRoomCode),{status:'revealed'})} onNext={async () => {
            const last = activeRoom.currentQuestionIndex >= activeRoom.questions.length -1;
            const nextIdx = activeRoom.currentQuestionIndex + 1;
            for(const p of players) await updateDoc(doc(db,'players',p.id),{currentAnswer:null,corrected:false});
            await updateDoc(doc(db,'rooms',currentRoomCode),{status:last?'finished':'active',currentQuestionIndex:last?activeRoom.currentQuestionIndex:nextIdx,timeLeft:activeRoom.questions[nextIdx]?.timer || 0, buzzerWinner: null, buzzerLockedOut: []});
        }} onCorrect={manualCorrect} onBuzzerCorrect={handleBuzzerHost}/>}

        {role === 'player' && activeRoom && <PlayerDashboard room={activeRoom} player={myProfile} onAnswer={async v => {
            await updateDoc(doc(db,'players',user.uid),{currentAnswer:v,[`answers.${activeRoom.currentQuestionIndex}`]:v});
        }} onBuzz={async () => {
            if(!activeRoom.buzzerWinner && !(activeRoom.buzzerLockedOut || []).includes(user.uid)) {
              await updateDoc(doc(db,'rooms',currentRoomCode),{buzzerWinner: user.uid, buzzerWinnerName: myProfile.name});
            }
        }}/>}
      </main>
    </div>
  );
}

// --- STARTSEITE MIT DEINEM NEUEN LOGO ---
function LoginView({ onJoin, onAdmin }) {
  const [c, setC] = useState(''); const [n, setN] = useState('');
  return (
    <div className="max-w-md mx-auto pt-10 text-center">
      
      {/* HIER IST DIE ÄNDERUNG: src="/logo.png" */}
      <img 
        src="/logo.png" 
        alt="QuizKopp Logo" 
        className="w-64 h-auto mx-auto mb-10 drop-shadow-[0_0_25px_rgba(99,102,241,0.4)] transition-transform hover:scale-105"
      />
      
      <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-xl space-y-4">
        <input placeholder="RAUM-CODE" className="w-full bg-slate-900 p-4 rounded-xl text-center text-2xl font-mono border border-slate-700 outline-none focus:border-indigo-500" value={c} onChange={e=>setC(e.target.value.toUpperCase())} maxLength={4}/>
        <input placeholder="TEAMNAME" className="w-full bg-slate-900 p-4 rounded-xl border border-slate-700 outline-none" value={n} onChange={e=>setN(e.target.value)}/>
        <button onClick={() => onJoin(c, n)} disabled={!c || !n} className="w-full bg-indigo-600 disabled:opacity-50 py-4 rounded-xl font-bold text-lg hover:bg-indigo-500 transition-colors shadow-lg">Jetzt beitreten</button>
      </div>
      <button onClick={onAdmin} className="mt-20 text-slate-700 hover:text-slate-500 text-xs">Admin-Zentrale</button>
    </div>
  );
}

function AdminLogin({ onOk, onBack }) {
  const [pw, setPw] = useState('');
  return (
    <div className="max-w-sm mx-auto bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-2xl mt-10">
      <h2 className="text-center font-bold mb-6 text-xl">Master-Login</h2>
      <input type="password" placeholder="Passwort" className="w-full bg-slate-900 p-3 rounded mb-4 border border-slate-700 outline-none" value={pw} onChange={e=>setPw(e.target.value)} onKeyPress={e=>e.key==='Enter'&&onOk(pw)} autoFocus/>
      <div className="flex gap-2"><button onClick={onBack} className="flex-1 bg-slate-700 py-2 rounded">Zurück</button><button onClick={()=>onOk(pw)} className="flex-1 bg-indigo-600 py-2 rounded font-bold shadow-lg">Login</button></div>
    </div>
  );
}

function AdminPanel({ onNew, onLib, onLogout }) {
  return (
    <div className="grid md:grid-cols-2 gap-6 pt-10">
      <button onClick={onNew} className="bg-emerald-600 p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform shadow-lg"><Plus size={48}/><span className="text-xl font-bold">Neues Quiz</span></button>
      <button onClick={onLib} className="bg-indigo-600 p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform shadow-lg"><FolderOpen size={48}/><span className="text-xl font-bold">Bibliothek</span></button>
      <button onClick={onLogout} className="md:col-span-2 text-slate-500 underline mt-10">Abmelden</button>
    </div>
  );
}

function Library({ onSelect, onBack, db }) {
  const [t, setT] = useState([]);
  useEffect(() => { getDocs(collection(db,'quiz_templates')).then(s=>setT(s.docs.map(d=>({id:d.id,...d.data()})))); }, []);
  const deleteQuiz = async (id) => { if(window.confirm("Bist du sicher?")) { await deleteDoc(doc(db, 'quiz_templates', id)); setT(t.filter(q => q.id !== id)); } };
  const renameQuiz = async (id, old) => { const n = window.prompt("Neuer Name:", old); if(n && n !== old) { await updateDoc(doc(db, 'quiz_templates', id), { title: n }); setT(t.map(q => q.id === id ? { ...q, title: n } : q)); } };
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><h2 className="text-2xl font-bold">Deine Quizzes</h2><button onClick={onBack} className="text-slate-400">Zurück</button></div>
      {t.map(x => (
        <div key={x.id} className="bg-slate-800 p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-slate-700">
          <div><p className="font-bold text-xl">{x.title}</p><p className="text-sm text-slate-500">{x.questions?.length || 0} Fragen</p></div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button onClick={() => renameQuiz(x.id, x.title)} className="p-3 text-slate-400 hover:text-indigo-400 bg-slate-900 rounded-lg"><Edit3 size={20}/></button>
            <button onClick={() => deleteQuiz(x.id)} className="p-3 text-slate-400 hover:text-red-400 bg-slate-900 rounded-lg"><Trash2 size={20}/></button>
            <button onClick={() => onSelect(x.questions)} className="bg-emerald-600 px-6 py-3 rounded-xl font-bold ml-auto sm:ml-2 shadow-lg w-full sm:w-auto">Laden</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function HostSetup({ onCreate, onBack, db }) {
  const [title, setTitle] = useState('');
  const [qs, setQs] = useState([{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:0,imgUrl:'',showImg:true}]);
  const update = (i,f,v) => { const n=[...qs]; n[i][f]=v; setQs(n); };
  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <input placeholder="Quiz-Name" className="bg-transparent text-2xl font-bold border-b border-slate-700 w-full outline-none" value={title} onChange={e=>setTitle(e.target.value)}/>
        <button onClick={async() => {if(!title)return alert("Titel fehlt!"); await setDoc(doc(collection(db,'quiz_templates')),{title,questions:qs,createdAt:Date.now()}); alert("Gespeichert!");}} className="bg-slate-800 p-2 rounded border border-slate-700"><Save size={20}/></button>
      </div>
      {qs.map((q,i) => (
        <div key={i} className="bg-slate-800 p-6 rounded-3xl border border-slate-700 space-y-4">
          <div className="flex gap-4">
            <input placeholder="Frage..." className="flex-1 bg-slate-900 p-2 rounded border border-slate-700" value={q.q} onChange={e=>update(i,'q',e.target.value)}/>
            <select className="bg-slate-900 p-2 rounded border border-slate-700" value={q.type} onChange={e=>update(i,'type',e.target.value)}>
              <option value="multiple">Multiple Choice</option><option value="text">Freitext</option><option value="estimation">Schätzung</option><option value="buzzer">Buzzer-Frage</option>
            </select>
          </div>
          <div className="flex gap-4 items-center flex-wrap">
            <input placeholder="Bild-URL (optional)" className="flex-1 min-w-[200px] bg-slate-900 p-2 rounded border border-slate-700 text-xs" value={q.imgUrl} onChange={e=>update(i,'imgUrl',e.target.value)}/>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <label>Auf Handy zeigen?</label><input type="checkbox" checked={q.showImg} onChange={e=>update(i,'showImg',e.target.checked)}/>
            </div>
            {q.type !== 'buzzer' && (
              <div className="flex items-center gap-2 ml-auto">
                <div className="text-right mr-2"><span className="block text-xs font-bold text-slate-400">Timer</span><span className="block text-[10px] text-slate-500">0=∞</span></div>
                <Clock size={16}/><input type="number" min="0" className="w-16 bg-slate-900 p-2 rounded border border-slate-700" value={q.timer} onChange={e=>update(i,'timer',parseInt(e.target.value) || 0)}/>
              </div>
            )}
          </div>
          {q.type==='multiple' && <div className="grid grid-cols-2 gap-2">{q.options.map((o,oi)=>(
            <div key={oi} className="flex gap-2 p-2 bg-slate-900 rounded"><input type="radio" checked={q.correctIndex==oi} onChange={()=>update(i,'correctIndex',oi)}/><input className="bg-transparent w-full" value={o} onChange={e=>{const no=[...q.options];no[oi]=e.target.value;update(i,'options',no)}}/></div>
          ))}</div>}
          {q.type==='estimation' && <input type="number" className="w-full bg-slate-900 p-2 rounded border border-slate-700" value={q.correctValue} onChange={e=>update(i,'correctValue',e.target.value)} placeholder="Richtiger Wert"/>}
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={()=>setQs([...qs,{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:0,imgUrl:'',showImg:true}])} className="flex-1 bg-slate-800 py-3 rounded-2xl border border-slate-700 font-bold">+ Frage</button>
        <button onClick={()=>onCreate(qs)} className="flex-1 bg-emerald-600 py-3 rounded-2xl font-bold">Quiz starten</button>
      </div>
    </div>
  );
}

function HostDashboard({ room, players, onReveal, onNext, onCorrect, onBuzzerCorrect }) {
  const q = room.questions[room.currentQuestionIndex];
  if (room.status === 'lobby') return (
    <div className="text-center py-20 space-y-12">
      <p className="text-3xl text-slate-400 uppercase tracking-widest font-bold">Raum-Code</p>
      <h2 className="text-[10rem] leading-none font-mono font-bold text-indigo-400">{room.id}</h2>
      <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 max-w-4xl mx-auto shadow-2xl">
        <h3 className="mb-8 font-bold flex items-center justify-center gap-3 text-3xl"><Users size={36}/> Teams ({players.length})</h3>
        <div className="flex flex-wrap gap-4 justify-center">{players.map(p=><span key={p.id} className="bg-slate-700 px-6 py-3 rounded-full text-xl font-semibold shadow-inner">{p.name}</span>)}</div>
      </div>
      <button onClick={()=>updateDoc(doc(db,'rooms',room.id),{status:'active'})} disabled={players.length===0} className="bg-emerald-600 px-24 py-8 rounded-full text-4xl font-bold disabled:opacity-50 shadow-xl transition-all mt-10">Quiz starten!</button>
    </div>
  );
  if (room.status === 'finished') return (
    <div className="space-y-8 max-w-4xl mx-auto py-10">
      <h2 className="text-center text-6xl text-yellow-400 font-bold mb-12">🏆 Endstand</h2>
      {players.map((p,i)=>(
        <div key={p.id} className={`p-8 rounded-3xl flex justify-between items-center border ${i===0?'bg-yellow-500/10 border-yellow-500 shadow-lg':'bg-slate-800 border-slate-700'}`}>
          <span className="text-3xl font-bold">{i+1}. {p.name}</span>
          <span className="font-mono text-4xl bg-slate-900 px-6 py-2 rounded-xl">{p.score}</span>
        </div>
      ))}
      <button onClick={()=>downloadCSV(players,room)} className="w-full bg-slate-800 border border-slate-700 py-6 rounded-3xl flex items-center justify-center gap-4 text-2xl font-bold mt-12"><Download size={32}/> Excel-Export (CSV)</button>
    </div>
  );
  return (
    <div className="grid lg:grid-cols-4 gap-8 h-full">
      <div className="lg:col-span-3 space-y-6 flex flex-col h-full">
        <div className="bg-slate-800 p-8 md:p-12 rounded-3xl border border-slate-700 shadow-2xl relative flex-grow flex flex-col">
          <div className="flex justify-between items-center mb-8">
             <span className="text-lg font-bold text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-4 py-2 rounded-full border border-indigo-500/20">Frage {room.currentQuestionIndex+1}/{room.questions.length}</span>
             {q.type !== 'buzzer' && <div className="flex items-center gap-3 text-yellow-400 font-mono text-4xl font-bold bg-slate-900 px-6 py-2 rounded-full border border-slate-700 shadow-inner"><Clock size={32}/> {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}</div>}
             {q.type === 'buzzer' && <div className="flex items-center gap-3 text-red-500 font-bold uppercase text-2xl bg-red-500/10 px-6 py-2 rounded-full border border-red-500/20 animate-pulse"><Bell size={28}/> Buzzer aktiv</div>}
          </div>
          {q.imgUrl && <img src={q.imgUrl} className="w-full max-h-[45vh] object-contain rounded-2xl mb-8 bg-slate-900/50 p-4 border border-slate-700"/>}
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-10 leading-tight">{q.q}</h2>
          {q.type === 'buzzer' && room.status === 'active' && room.buzzerWinner && (
            <div className="bg-red-500/20 border-2 border-red-500 p-12 rounded-3xl text-center shadow-2xl animate-pulse mt-auto">
              <p className="text-red-400 font-bold text-xl mb-4 uppercase tracking-widest">Schnellster Buzzer:</p>
              <h3 className="text-6xl md:text-7xl font-black text-white mb-12">{room.buzzerWinnerName}</h3>
              <div className="flex gap-6 justify-center">
                <button onClick={()=>onBuzzerCorrect(false)} className="bg-slate-800 border border-slate-700 hover:bg-red-600 px-8 py-5 rounded-2xl font-bold text-xl flex items-center gap-3"><XCircle size={28}/> Falsch</button>
                <button onClick={()=>onBuzzerCorrect(true)} className="bg-emerald-600 hover:bg-emerald-500 px-8 py-5 rounded-2xl font-bold text-xl flex items-center gap-3"><CheckCircle size={28}/> Richtig</button>
              </div>
            </div>
          )}
          {room.status === 'revealed' && q.type !== 'buzzer' && <div className="bg-emerald-500/10 border border-emerald-500/50 p-8 rounded-2xl mb-6 mt-auto"><p className="text-emerald-500 font-bold uppercase tracking-widest mb-2">Lösung</p><p className="text-4xl font-bold">{q.type==='multiple'?q.options[q.correctIndex]:q.type==='estimation'?q.correctValue:'Manual'}</p></div>}
          {room.status === 'revealed' && q.type === 'text' && <div className="space-y-4 mt-auto">{players.map(p=>(
            <div key={p.id} className="flex justify-between items-center bg-slate-900 p-6 rounded-2xl border border-slate-700">
              <div className="pr-4"><span className="text-sm font-bold text-slate-500 uppercase">{p.name}</span><p className="text-2xl italic mt-1">"{p.currentAnswer||'---'}"</p></div>
              <div className="flex gap-3"><button onClick={()=>onCorrect(p.id,false)} className={`p-4 rounded-xl ${p.corrected&&!p.wasCorrect?'bg-red-600':'bg-slate-800'}`}><XCircle size={32}/></button><button onClick={()=>onCorrect(p.id,true)} className={`p-4 rounded-xl ${p.corrected&&p.wasCorrect?'bg-emerald-600':'bg-slate-800'}`}><CheckCircle size={32}/></button></div>
            </div>
          ))}</div>}
        </div>
        {(q.type !== 'buzzer' || room.status === 'revealed') && <button onClick={room.status === 'active' ? onReveal : onNext} className={`w-full py-8 rounded-3xl font-bold text-3xl shadow-xl transition-all hover:scale-[1.02] ${room.status === 'active' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>{room.status === 'active' ? 'Lösung auflösen' : 'Nächste Frage'}</button>}
      </div>
      <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 h-fit sticky top-24 shadow-2xl">
        <h3 className="text-2xl font-bold mb-8 uppercase tracking-widest text-slate-400">Ranking</h3>
        <div className="space-y-4">{players.map((p, index)=>(
            <div key={p.id} className="flex justify-between text-lg items-center bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
              <span className="font-bold flex items-center gap-3"><span className="text-slate-500 text-sm">{index + 1}.</span> {p.name}</span>
              <div className="flex items-center gap-4">{(p.currentAnswer || p.id === room.buzzerWinner) ? <CheckCircle size={20} className="text-emerald-500"/> : <div className="w-3 h-3 rounded-full bg-slate-700 animate-pulse mt-1"/>}<span className="font-mono font-bold bg-slate-900 px-3 py-1 rounded-lg border border-slate-600 text-indigo-300">{p.score}</span></div>
            </div>
          ))}</div>
      </div>
    </div>
  );
}

function PlayerDashboard({ room, player, onAnswer, onBuzz }) {
  if (!player) return null;
  const q = room.questions[room.currentQuestionIndex];
  const [v, setV] = useState('');
  const isLockedOut = (room.buzzerLockedOut || []).includes(player.id);
  if (room.status === 'lobby') return <div className="text-center py-20 bg-slate-800 rounded-3xl border border-slate-700 shadow-xl max-w-sm mx-auto"><h2 className="text-2xl font-bold">Team {player.name}</h2><p className="mt-8 animate-pulse text-indigo-400">Warte auf Start...</p></div>;
  if (room.status === 'finished') return <div className="text-center py-20 bg-slate-800 rounded-3xl border border-slate-700 shadow-xl max-w-sm mx-auto"><Trophy size={64} className="mx-auto text-yellow-400 mb-6"/><div className="text-6xl font-bold">{player.score}</div></div>;
  if (q.type === 'buzzer') {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest mb-6"><span>Frage {room.currentQuestionIndex+1}</span><span className="text-indigo-400">Score: {player.score}</span></div>
        {q.imgUrl && q.showImg && <img src={q.imgUrl} className="w-full h-40 object-contain rounded-xl bg-slate-800 p-2 border border-slate-700 mb-6"/>}
        <h2 className="text-2xl font-bold mb-10">{q.q}</h2>
        {room.status === 'active' && !room.buzzerWinner && !isLockedOut && <button onClick={onBuzz} className="w-64 h-64 rounded-full bg-red-600 border-8 border-red-800 shadow-[0_10px_0_#7f1d1d,0_0_50px_rgba(220,38,38,0.5)] active:translate-y-[10px] active:shadow-none transition-all mx-auto flex items-center justify-center"><span className="text-4xl font-black text-white">BUZZER</span></button>}
        {room.status === 'active' && room.buzzerWinner && room.buzzerWinner === player.id && <div className="py-12 bg-red-500/20 rounded-3xl border-2 border-red-500 animate-pulse text-3xl font-bold text-red-400">DU BIST DRAN!</div>}
        {room.status === 'revealed' && <div className={`py-12 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-500/10 border-emerald-500':'bg-slate-800 border-slate-700'}`}><h3 className="text-2xl font-bold">{player.wasCorrect?'Punkt!':'Vorbei'}</h3></div>}
      </div>
    );
  }
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest"><span>Frage {room.currentQuestionIndex+1}</span><span className="flex items-center gap-1 text-yellow-500"><Clock size={12}/> {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}</span></div>
      <h2 className="text-2xl font-bold leading-tight">{q.q}</h2>
      {q.imgUrl && q.showImg && <img src={q.imgUrl} className="w-full h-48 object-contain rounded-xl bg-slate-800 p-2 border border-slate-700"/>}
      {room.status === 'active' && !player.currentAnswer && (
        <div className="space-y-3 pt-4">
          {q.type === 'multiple' && q.options.map((o,i)=><button key={i} onClick={()=>onAnswer(i)} className="w-full bg-slate-800 p-5 rounded-2xl text-left border border-slate-700 hover:bg-indigo-600 transition-colors">{o}</button>)}
          {(q.type === 'text' || q.type === 'estimation') && <div className="space-y-4"><input type={q.type==='estimation'?'number':'text'} className="w-full bg-slate-900 p-5 rounded-2xl border border-slate-700 outline-none focus:border-indigo-500" value={v} onChange={e=>setV(e.target.value)} placeholder="Antwort..."/><button onClick={()=>onAnswer(v)} disabled={!v} className="w-full bg-indigo-600 py-4 rounded-2xl font-bold">Abschicken</button></div>}
        </div>
      )}
      {player.currentAnswer && room.status === 'active' && <div className="text-center py-12 bg-slate-800 rounded-3xl border border-slate-700">Eingeloggt!</div>}
      {room.status === 'revealed' && <div className={`py-12 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-500/10 border-emerald-500':'bg-red-500/10 border-red-500'}`}><h3 className="text-2xl font-bold">{player.wasCorrect?'Punkt!':'Kein Punkt'}</h3></div>}
    </div>
  );
}