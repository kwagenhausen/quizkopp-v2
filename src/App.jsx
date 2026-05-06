import React, { useState, useEffect } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List, Save, FolderOpen, Download, Trash2, Lock, Image as ImageIcon, Clock } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';

// --- KONFIGURATION ---
const ADMIN_PASSWORD = "test"; // DEIN PASSWORT

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
      if (q.type === 'multiple' && a !== undefined) row.push(q.options[a]?.replace(/,/g, "") || "---");
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
    onSnapshot(collection(db, 'rooms'), s => setAllRooms(s.docs.map(d => ({id: d.id, ...d.data()}))));
    onSnapshot(collection(db, 'players'), s => setAllPlayers(s.docs.map(d => ({id: d.id, ...d.data()}))));
  }, [user]);

  const activeRoom = allRooms.find(r => r.id === currentRoomCode);
  const players = allPlayers.filter(p => p.roomCode === currentRoomCode).sort((a,b) => b.score - a.score);
  const myProfile = allPlayers.find(p => p.id === user?.uid);

  // Timer Logik (Host-Seite)
  useEffect(() => {
    let interval;
    if (role === 'host' && activeRoom?.status === 'active' && activeRoom?.timeLeft > 0) {
      interval = setInterval(async () => {
        const newTime = activeRoom.timeLeft - 1;
        await updateDoc(doc(db, 'rooms', currentRoomCode), { timeLeft: newTime });
        if (newTime <= 0) await updateDoc(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [role, activeRoom?.status, activeRoom?.timeLeft]);

  const createRoom = async (questions) => {
    const code = generateRoomCode();
    await setDoc(doc(db, 'rooms', code), {
      hostId: user.uid, status: 'lobby', currentQuestionIndex: 0, questions,
      timeLeft: questions[0].timer || 0, createdAt: Date.now()
    });
    setCurrentRoomCode(code); setRole('host');
  };

  const manualCorrect = async (pId, ok) => {
    const p = players.find(x => x.id === pId);
    await updateDoc(doc(db, 'players', pId), { score: ok ? p.score + 1 : p.score, corrected: true, wasCorrect: ok });
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Lade QuizKopp Pro...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2"><Trophy className="text-yellow-400"/><h1 className="text-xl font-bold">QuizKopp Pro</h1></div>
          {role && <button onClick={() => { if(role==='host') deleteDoc(doc(db,'rooms',currentRoomCode)); setRole(null); setCurrentRoomCode(''); }} className="text-slate-400 hover:text-red-400 transition-colors"><LogOut size={20}/></button>}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 py-8">
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
            await updateDoc(doc(db,'rooms',currentRoomCode),{status:last?'finished':'active',currentQuestionIndex:last?activeRoom.currentQuestionIndex:nextIdx,timeLeft:activeRoom.questions[nextIdx]?.timer || 0});
        }} onCorrect={manualCorrect}/>}

        {role === 'player' && activeRoom && <PlayerDashboard room={activeRoom} player={myProfile} onAnswer={async v => {
            await updateDoc(doc(db,'players',user.uid),{currentAnswer:v,[`answers.${activeRoom.currentQuestionIndex}`]:v});
        }}/>}
      </main>
    </div>
  );
}

// --- VIEWS ---
function LoginView({ onJoin, onAdmin }) {
  const [c, setC] = useState(''); const [n, setN] = useState('');
  return (
    <div className="max-w-md mx-auto pt-10 text-center">
      <div className="bg-indigo-600 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl">
        <Trophy size={48} className="text-white"/>
      </div>
      <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-xl space-y-4">
        <input placeholder="RAUM-CODE" className="w-full bg-slate-900 p-4 rounded-xl text-center text-2xl font-mono border border-slate-700 outline-none focus:border-indigo-500" value={c} onChange={e=>setC(e.target.value.toUpperCase())} maxLength={4}/>
        <input placeholder="TEAMNAME" className="w-full bg-slate-900 p-4 rounded-xl border border-slate-700 outline-none" value={n} onChange={e=>setN(e.target.value)}/>
        <button onClick={() => onJoin(c, n)} className="w-full bg-indigo-600 py-4 rounded-xl font-bold text-lg hover:bg-indigo-500 transition-colors">Beitreten</button>
      </div>
      <button onClick={onAdmin} className="mt-20 text-slate-700 hover:text-slate-500 text-xs">Admin-Zentrale</button>
    </div>
  );
}

function AdminLogin({ onOk, onBack }) {
  const [pw, setPw] = useState('');
  return (
    <div className="max-w-sm mx-auto bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-2xl mt-10">
      <h2 className="text-center font-bold mb-6">Admin Zugang</h2>
      <input type="password" placeholder="Passwort" className="w-full bg-slate-900 p-3 rounded mb-4 border border-slate-700" value={pw} onChange={e=>setPw(e.target.value)} onKeyPress={e=>e.key==='Enter'&&onOk(pw)}/>
      <div className="flex gap-2"><button onClick={onBack} className="flex-1 bg-slate-700 py-2 rounded">Zurück</button><button onClick={()=>onOk(pw)} className="flex-1 bg-indigo-600 py-2 rounded">Login</button></div>
    </div>
  );
}

function AdminPanel({ onNew, onLib, onLogout }) {
  return (
    <div className="grid md:grid-cols-2 gap-6 pt-10">
      <button onClick={onNew} className="bg-emerald-600 p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform">
        <Plus size={48}/><span className="text-xl font-bold">Neues Quiz</span>
      </button>
      <button onClick={onLib} className="bg-indigo-600 p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform">
        <FolderOpen size={48}/><span className="text-xl font-bold">Bibliothek</span>
      </button>
      <button onClick={onLogout} className="md:col-span-2 text-slate-500 underline mt-10">Abmelden</button>
    </div>
  );
}

function Library({ onSelect, onBack, db }) {
  const [t, setT] = useState([]);
  useEffect(() => { getDocs(collection(db,'quiz_templates')).then(s=>setT(s.docs.map(d=>({id:d.id,...d.data()})))); }, []);
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><h2 className="text-2xl font-bold">Deine Quizzes</h2><button onClick={onBack} className="text-slate-400">Zurück</button></div>
      {t.map(x => (
        <div key={x.id} className="bg-slate-800 p-6 rounded-2xl flex justify-between items-center border border-slate-700">
          <div><p className="font-bold">{x.title}</p><p className="text-xs text-slate-500">{x.questions.length} Fragen</p></div>
          <button onClick={() => onSelect(x.questions)} className="bg-emerald-600 px-4 py-2 rounded-lg font-bold">Laden</button>
        </div>
      ))}
    </div>
  );
}

function HostSetup({ onCreate, onBack, db }) {
  const [title, setTitle] = useState('');
  const [qs, setQs] = useState([{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:30,imgUrl:'',showImg:true}]);
  const update = (i,f,v) => { const n=[...qs]; n[i][f]=v; setQs(n); };
  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <input placeholder="Quiz-Name" className="bg-transparent text-2xl font-bold border-b border-slate-700 w-full outline-none" value={title} onChange={e=>setTitle(e.target.value)}/>
        <button onClick={async() => {await setDoc(doc(collection(db,'quiz_templates')),{title,questions:qs,createdAt:Date.now()}); alert("Gespeichert!");}} className="bg-slate-800 p-2 rounded border border-slate-700"><Save size={20}/></button>
      </div>
      {qs.map((q,i) => (
        <div key={i} className="bg-slate-800 p-6 rounded-3xl border border-slate-700 space-y-4">
          <div className="flex gap-4">
            <input placeholder="Frage..." className="flex-1 bg-slate-900 p-2 rounded border border-slate-700" value={q.q} onChange={e=>update(i,'q',e.target.value)}/>
            <select className="bg-slate-900 p-2 rounded border border-slate-700" value={q.type} onChange={e=>update(i,'type',e.target.value)}>
              <option value="multiple">Multiple Choice</option><option value="text">Freitext</option><option value="estimation">Schätzung</option>
            </select>
          </div>
          <div className="flex gap-4">
            <input placeholder="Bild-URL (optional)" className="flex-1 bg-slate-900 p-2 rounded border border-slate-700 text-xs" value={q.imgUrl} onChange={e=>update(i,'imgUrl',e.target.value)}/>
            <div className="flex items-center gap-2 text-xs">
              <label>Auf Handy zeigen?</label>
              <input type="checkbox" checked={q.showImg} onChange={e=>update(i,'showImg',e.target.checked)}/>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={16}/><input type="number" className="w-16 bg-slate-900 p-1 rounded border border-slate-700" value={q.timer} onChange={e=>update(i,'timer',parseInt(e.target.value))}/>
            </div>
          </div>
          {q.type==='multiple' && <div className="grid grid-cols-2 gap-2">{q.options.map((o,oi)=>(
            <div key={oi} className="flex gap-2 p-2 bg-slate-900 rounded"><input type="radio" checked={q.correctIndex==oi} onChange={()=>update(i,'correctIndex',oi)}/><input className="bg-transparent w-full" value={o} onChange={e=>{const no=[...q.options];no[oi]=e.target.value;update(i,'options',no)}}/></div>
          ))}</div>}
          {q.type==='estimation' && <input type="number" className="w-full bg-slate-900 p-2 rounded border border-slate-700" value={q.correctValue} onChange={e=>update(i,'correctValue',e.target.value)} placeholder="Richtiger Wert"/>}
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={()=>setQs([...qs,{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:30,imgUrl:'',showImg:true}])} className="flex-1 bg-slate-800 py-3 rounded-2xl border border-slate-700 font-bold">+ Frage</button>
        <button onClick={()=>onCreate(qs)} className="flex-1 bg-emerald-600 py-3 rounded-2xl font-bold">Quiz starten</button>
      </div>
    </div>
  );
}

function HostDashboard({ room, players, onReveal, onNext, onCorrect }) {
  const q = room.questions[room.currentQuestionIndex];
  if (room.status === 'lobby') return <div className="text-center py-10 space-y-10"><h2 className="text-7xl font-mono font-bold text-indigo-400">{room.id}</h2><div className="flex flex-wrap justify-center gap-2">{players.map(p=><span key={p.id} className="bg-slate-800 px-4 py-2 rounded-full border border-slate-700">{p.name}</span>)}</div><button onClick={()=>updateDoc(doc(db,'rooms',room.id),{status:'active'})} className="bg-emerald-600 px-16 py-4 rounded-full text-2xl font-bold">Start!</button></div>;
  if (room.status === 'finished') return <div className="space-y-4 max-w-xl mx-auto"><h2 className="text-center text-4xl text-yellow-400 font-bold">🏆 Endstand</h2>{players.map((p,i)=><div key={p.id} className="bg-slate-800 p-4 rounded-2xl flex justify-between border border-slate-700"><span>{i+1}. {p.name}</span><span className="font-mono text-xl">{p.score}</span></div>)}<button onClick={()=>downloadCSV(players,room)} className="w-full bg-slate-800 border border-slate-700 py-4 rounded-2xl flex items-center justify-center gap-2 font-bold"><Download/> Excel-Export</button></div>;

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-6">
        <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-xl relative">
          <div className="flex justify-between items-center mb-6">
             <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Frage {room.currentQuestionIndex+1}/{room.questions.length}</span>
             <div className="flex items-center gap-2 text-yellow-400 font-mono text-2xl"><Clock/> {room.timeLeft}s</div>
          </div>
          {q.imgUrl && <img src={q.imgUrl} className="w-full h-48 object-contain rounded-xl mb-6 bg-slate-900 p-2"/>}
          <h2 className="text-3xl font-bold mb-8">{q.q}</h2>
          {room.status === 'revealed' && <div className="bg-emerald-500/10 border border-emerald-500/50 p-4 rounded-xl mb-6">Lösung: <span className="font-bold">{q.type==='multiple'?q.options[q.correctIndex]:q.type==='estimation'?q.correctValue:'Manual'}</span></div>}
          {room.status === 'revealed' && q.type === 'text' && <div className="space-y-2">{players.map(p=>(
            <div key={p.id} className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
              <div className="pr-2"><span className="text-xs text-slate-500 uppercase">{p.name}</span><p className="italic">"{p.currentAnswer||'---'}"</p></div>
              <div className="flex gap-2"><button onClick={()=>onCorrect(p.id,false)} className={`p-2 rounded ${p.corrected&&!p.wasCorrect?'bg-red-600':'bg-slate-800'}`}><XCircle/></button><button onClick={()=>onCorrect(p.id,true)} className={`p-2 rounded ${p.corrected&&p.wasCorrect?'bg-emerald-600':'bg-slate-800'}`}><CheckCircle/></button></div>
            </div>
          ))}</div>}
        </div>
        <button onClick={room.status === 'active' ? onReveal : onNext} className={`w-full py-5 rounded-2xl font-bold text-xl shadow-lg ${room.status === 'active' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>{room.status === 'active' ? 'Auflösen' : 'Weiter'}</button>
      </div>
      <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 h-fit">
        <h3 className="font-bold mb-4">Ranking</h3>
        {players.map(p=><div key={p.id} className="flex justify-between text-sm py-2 border-b border-slate-700/50"><span>{p.name}</span><div className="flex gap-2"> {p.currentAnswer?<CheckCircle size={14} className="text-emerald-500"/>:<div className="w-2 h-2 rounded-full bg-slate-700 animate-pulse mt-1.5"/>} <span className="font-mono">{p.score}</span></div></div>)}
      </div>
    </div>
  );
}

function PlayerDashboard({ room, player, onAnswer }) {
  if (!player) return null;
  const q = room.questions[room.currentQuestionIndex];
  const [v, setV] = useState('');
  if (room.status === 'lobby') return <div className="text-center py-20 bg-slate-800 rounded-3xl border border-slate-700 shadow-xl max-w-sm mx-auto"><h2 className="text-2xl font-bold">Team {player.name}</h2><p className="mt-8 animate-pulse text-indigo-400">Warte auf Start...</p></div>;
  if (room.status === 'finished') return <div className="text-center py-20 bg-slate-800 rounded-3xl border border-slate-700 shadow-xl max-w-sm mx-auto"><Trophy size={64} className="mx-auto text-yellow-400 mb-6"/><div className="text-6xl font-bold">{player.score}</div></div>;

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
        <span>Frage {room.currentQuestionIndex+1}</span>
        <span className="flex items-center gap-1 text-yellow-500"><Clock size={12}/> {room.timeLeft}s</span>
      </div>
      <h2 className="text-2xl font-bold leading-tight">{q.q}</h2>
      {q.imgUrl && q.showImg && <img src={q.imgUrl} className="w-full h-40 object-contain rounded-xl bg-slate-800 p-2 border border-slate-700"/>}
      {room.status === 'active' && !player.currentAnswer && (
        <div className="space-y-3">
          {q.type === 'multiple' && q.options.map((o,i)=><button key={i} onClick={()=>onAnswer(i)} className="w-full bg-slate-800 p-5 rounded-2xl text-left border border-slate-700 hover:bg-indigo-600 transition-colors">{o}</button>)}
          {(q.type === 'text' || q.type === 'estimation') && <div className="space-y-4"><input type={q.type==='estimation'?'number':'text'} className="w-full bg-slate-900 p-5 rounded-2xl border border-slate-700 outline-none focus:border-indigo-500" value={v} onChange={e=>setV(e.target.value)} placeholder="Deine Antwort..."/><button onClick={()=>onAnswer(v)} disabled={!v} className="w-full bg-indigo-600 py-4 rounded-2xl font-bold">Abschicken</button></div>}
        </div>
      )}
      {player.currentAnswer && room.status === 'active' && <div className="text-center py-12 bg-slate-800 rounded-3xl border border-slate-700 shadow-inner">Antwort eingeloggt!</div>}
      {room.status === 'revealed' && <div className={`py-12 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-500/10 border-emerald-500':'bg-red-500/10 border-red-500'}`}><h3 className="text-2xl font-bold">{player.wasCorrect?'Punkt!':'Kein Punkt'}</h3></div>}
    </div>
  );
}