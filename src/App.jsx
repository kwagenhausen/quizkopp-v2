import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, Users, Trophy, CheckCircle, XCircle, ArrowRight, LogOut, MessageSquare, Hash, List, Save, FolderOpen, Download, Trash2, Lock, Image as ImageIcon, Clock, Bell, Edit3, Upload } from 'lucide-react';
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

// --- HELFER: KONFETTI ANIMATION ---
const Confetti = () => {
  const [particles] = useState(() => Array.from({ length: 120 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    animationDelay: Math.random() * 3,
    color: ['#E69F00', '#10B981', '#3B82F6', '#EF4444', '#F472B6', '#A855F7'][Math.floor(Math.random() * 6)],
    size: Math.random() * 8 + 6
  })));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map(p => (
        <div key={p.id} 
             className="absolute top-[-5vh] rounded-sm opacity-80"
             style={{
               left: `${p.left}%`,
               width: `${p.size}px`,
               height: `${p.size}px`,
               backgroundColor: p.color,
               animation: `fall 3.5s linear ${p.animationDelay}s infinite`
             }}
        />
      ))}
      <style>{`
        @keyframes fall {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg) scale(0.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// --- HELFER: MULTIMEDIA ---
const getMediaType = (url) => {
  if (!url) return 'none';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.endsWith('.mp3') || lowerUrl.endsWith('.wav') || lowerUrl.endsWith('.m4a') || lowerUrl.endsWith('.ogg')) return 'audio';
  return 'image';
};

const getYouTubeEmbedUrl = (url) => {
  try {
    let videoId = '';
    if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1].split(/[?#]/)[0];
    } else if (url.includes('youtube.com/watch')) {
        videoId = url.split('v=')[1].split('&')[0];
    } else if (url.includes('youtube.com/embed/')) {
        return url; 
    }
    return `https://www.youtube.com/embed/${videoId}?rel=0`;
  } catch (e) {
    return url;
  }
};

// --- HELFER: TEAM BERECHNUNG ---
const getSortedTeams = (players, room) => {
  if (!room || !players) return [];
  const teamsMap = {};
  
  players.forEach(p => {
      const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
      if (!teamsMap[tId]) {
          teamsMap[tId] = { 
              name: tId, 
              players: [], 
              playerScoreSum: 0, 
              estimationScore: room.teamScores?.[tId] || 0 
          };
      }
      teamsMap[tId].players.push(p);
      teamsMap[tId].playerScoreSum += p.score;
  });

  Object.values(teamsMap).forEach(t => {
      t.totalScore = t.playerScoreSum + t.estimationScore;
  });

  return Object.values(teamsMap).sort((a,b) => b.totalScore - a.totalScore);
};

// --- HELFER: WEITERE ---
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';
  for (let i = 0; i < 4; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
};

const downloadCSV = (players, room) => {
  const sortedTeams = getSortedTeams(players, room);
  const headers = ["Team-Platz", "Team", "Team-Punkte Gesamt", "Spieler", "Spieler-Punkte (ohne Schätzen)"];
  
  room.questions.forEach((q, i) => {
      headers.push(q.type === 'break' ? `Pause: ${q.q.replace(/,/g, "")}` : `F${i+1}: ${q.q.replace(/,/g, "")}`);
  });
  
  const rows = players.map(p => {
    const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
    const myTeam = sortedTeams.find(t => t.name === tId);
    const teamRank = sortedTeams.findIndex(t => t.name === tId) + 1;

    const row = [teamRank, tId, myTeam.totalScore, p.name, p.score];
    room.questions.forEach((q, qi) => {
      const a = p.answers?.[qi];
      if (q.type === 'break') row.push("---");
      else if (q.type === 'multiple' && a !== undefined && a !== "") row.push(q.options[a]?.replace(/,/g, "") || "---");
      else if (q.type === 'buzzer') row.push(a ? "Gebuzzert & Richtig" : "---");
      else row.push(a?.toString().replace(/,/g, "") || "---");
    });
    return row;
  });

  rows.sort((a, b) => a[0] - b[0]);

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

  const createRoom = async (questions, allowJokers = true) => {
    const code = generateRoomCode();
    await setDoc(doc(db, 'rooms', code), {
      hostId: user.uid, status: 'lobby', currentQuestionIndex: 0, questions,
      timeLeft: questions[0].timer || 0, buzzerWinner: null, buzzerLockedOut: [], teamScores: {}, allowJokers: allowJokers, createdAt: Date.now()
    });
    setCurrentRoomCode(code); setRole('host');
  };

  const manualCorrect = async (pId, basePointsToAward) => {
    const p = players.find(x => x.id === pId);
    const pUsedJoker = p.jokerQuestion === activeRoom.currentQuestionIndex;
    const multiplier = pUsedJoker ? 2 : 1;
    const finalPoints = basePointsToAward * multiplier;

    const oldAwarded = p.currentAwardedPoints || 0;
    const newScore = p.score - oldAwarded + finalPoints;

    await updateDoc(doc(db, 'players', pId), { 
        score: newScore, 
        corrected: true, 
        wasCorrect: finalPoints > 0,
        currentAwardedPoints: finalPoints
    });
  };

  const handleBuzzerHost = async (isCorrect) => {
    const pId = activeRoom.buzzerWinner;
    const batch = writeBatch(db);
    
    const buzzingPlayer = players.find(p => p.id === pId);
    const buzzingTeamId = buzzingPlayer && buzzingPlayer.team && buzzingPlayer.team.trim() !== "" ? buzzingPlayer.team.trim() : buzzingPlayer?.name;

    for (const player of players) {
      const playerTeamId = player.team && player.team.trim() !== "" ? player.team.trim() : player.name;
      const pUsedJoker = player.jokerQuestion === activeRoom.currentQuestionIndex;
      const winPts = pUsedJoker ? 2 : 1;

      if (isCorrect) {
        const isWinner = player.id === pId;
        batch.update(doc(db, 'players', player.id), { 
            score: isWinner ? player.score + winPts : player.score, 
            wasCorrect: isWinner,
            ...(isWinner ? {[`answers.${activeRoom.currentQuestionIndex}`]: true} : {})
        });
      } else {
        const isOtherTeam = playerTeamId !== buzzingTeamId;
        batch.update(doc(db, 'players', player.id), { 
            score: isOtherTeam ? player.score + 1 : player.score, 
            wasCorrect: isOtherTeam,
            ...(isOtherTeam ? {[`answers.${activeRoom.currentQuestionIndex}`]: true} : {})
        });
      }
    }
    
    batch.update(doc(db, 'rooms', currentRoomCode), { status: 'revealed' });
    await batch.commit();
  };

  const revealAnswer = async () => {
    if(!activeRoom) return;
    const q = activeRoom.questions[activeRoom.currentQuestionIndex];
    const batch = writeBatch(db);

    if (q.type === 'multiple') {
      for (const p of players) {
        const hasAnswered = p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "";
        const isCorrect = hasAnswered && (p.currentAnswer == q.correctIndex);
        
        const pUsedJoker = p.jokerQuestion === activeRoom.currentQuestionIndex;
        const pts = pUsedJoker ? 2 : 1;

        batch.update(doc(db, 'players', p.id), { score: isCorrect ? p.score + pts : p.score, wasCorrect: isCorrect });
      }
    } else if (q.type === 'estimation') {
      const validPlayers = players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "");
      if (validPlayers.length > 0) {
        const target = parseFloat(q.correctValue);
        const teams = {};
        for (const p of validPlayers) {
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
          if (!teams[tId]) teams[tId] = { sum: 0, count: 0 };
          teams[tId].sum += parseFloat(p.currentAnswer);
          teams[tId].count++;
        }
        let minDiff = Infinity;
        const teamDiffs = {};
        for (const tId in teams) {
          const avg = teams[tId].sum / teams[tId].count;
          const diff = Math.abs(avg - target);
          teamDiffs[tId] = diff;
          if (diff < minDiff) minDiff = diff;
        }
        
        const isBullseye = minDiff < 0.0001; 
        const basePts = isBullseye ? 2 : 1; 

        const winningTeams = Object.keys(teamDiffs).filter(tId => teamDiffs[tId] === minDiff);
        const newTeamScores = { ...(activeRoom.teamScores || {}) };
        
        winningTeams.forEach(tId => {
            const teamUsedJoker = validPlayers.some(p => {
                const ptId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
                return ptId === tId && p.jokerQuestion === activeRoom.currentQuestionIndex;
            });
            
            const finalPts = teamUsedJoker ? basePts * 2 : basePts;
            newTeamScores[tId] = (newTeamScores[tId] || 0) + finalPts;
        });
        
        batch.update(doc(db, 'rooms', currentRoomCode), { teamScores: newTeamScores });

        for (const p of players) {
          const hasAnswered = p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "";
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
          const isCorrect = hasAnswered && winningTeams.includes(tId);
          batch.update(doc(db, 'players', p.id), { wasCorrect: isCorrect });
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
        {!role && !adminAuth && <LoginView allPlayers={allPlayers} onJoin={async (c, n, t) => {
            const roomCode = c.toUpperCase();
            const playerName = n.trim();
            if(!allRooms.find(r=>r.id===roomCode)) return alert("Raum nicht gefunden!");
            
            const existingPlayer = allPlayers.find(p => p.roomCode === roomCode && p.name.toLowerCase() === playerName.toLowerCase());
            
            if (existingPlayer) {
                if (existingPlayer.id !== user.uid) {
                    const { id, ...oldData } = existingPlayer; 
                    await deleteDoc(doc(db, 'players', existingPlayer.id));
                    await setDoc(doc(db, 'players', user.uid), { ...oldData, team: t });
                } else {
                    await updateDoc(doc(db, 'players', user.uid), { team: t });
                }
            } else {
                await setDoc(doc(db,'players',user.uid),{name:playerName, team:t, roomCode:roomCode, score:0, currentAnswer:null, answers:{}, jokerUsed: false, jokerQuestion: null});
            }
            setCurrentRoomCode(roomCode); setRole('player');
        }} onAdmin={() => setAdminAuth('login')}/>}

        {adminAuth === 'login' && <AdminLogin onOk={pw => pw === ADMIN_PASSWORD ? setAdminAuth(true) : alert("Falsch!")} onBack={() => setAdminAuth(false)}/>}
        
        {adminAuth === true && !role && <AdminPanel onNew={() => { setEditingQuiz(null); setRole('setup'); }} onLib={() => setRole('lib')} onLogout={() => setAdminAuth(false)}/>}
        
        {role === 'setup' && <HostSetup onCreate={createRoom} onBack={() => setRole(null)} db={db} initialQuiz={editingQuiz} />}
        
        {role === 'lib' && <Library onSelect={x => createRoom(x.questions, x.allowJokers)} onEdit={quiz => { setEditingQuiz(quiz); setRole('setup'); }} onBack={() => setRole(null)} db={db}/>}

        {role === 'host' && activeRoom && <HostDashboard room={activeRoom} players={players} onReveal={revealAnswer} onNext={async () => {
            const last = activeRoom.currentQuestionIndex >= activeRoom.questions.length -1;
            const nextIdx = activeRoom.currentQuestionIndex + 1;
            const batch = writeBatch(db);
            for(const p of players) {
              batch.update(doc(db,'players',p.id),{currentAnswer:null, corrected:false, wasCorrect:null, currentAwardedPoints:0});
            }
            batch.update(doc(db,'rooms',currentRoomCode),{
              status:last?'finished':'active',
              currentQuestionIndex:last?activeRoom.currentQuestionIndex:nextIdx,
              timeLeft:activeRoom.questions[nextIdx]?.timer || 0, 
              buzzerWinner: null, 
              buzzerReaction: null,
              buzzerLockedOut: []
            });
            await batch.commit();
        }} onCorrect={manualCorrect} onBuzzerCorrect={handleBuzzerHost}/>}

        {role === 'player' && activeRoom && <PlayerDashboard room={activeRoom} player={myProfile} players={players} onAnswer={async v => {
            await updateDoc(doc(db,'players',user.uid),{currentAnswer:v,[`answers.${activeRoom.currentQuestionIndex}`]:v});
        }} onUseJoker={async () => {
            if(window.confirm("Bist du sicher? Der Joker kann nur EINMAL pro Quiz eingesetzt werden!")) {
                await updateDoc(doc(db, 'players', user.uid), { jokerUsed: true, jokerQuestion: activeRoom.currentQuestionIndex });
            }
        }} onBuzz={async (reactionTime) => {
            if(!activeRoom.buzzerWinner && !(activeRoom.buzzerLockedOut || []).includes(user.uid)) {
              await updateDoc(doc(db,'rooms',currentRoomCode),{buzzerWinner: user.uid, buzzerWinnerName: myProfile.name, buzzerReaction: reactionTime});
            }
        }}/>}
      </main>
    </div>
  );
}

function LoginView({ allPlayers, onJoin, onAdmin }) {
  const [c, setC] = useState(''); 
  const [n, setN] = useState('');
  const [t, setT] = useState(''); 
  
  const activeRoomCode = c.toUpperCase();
  const existingTeams = [...new Set(
    allPlayers
      .filter(p => p.roomCode === activeRoomCode && p.team && p.team.trim() !== '')
      .map(p => p.team.trim())
  )];

  return (
    <div className="max-w-md mx-auto pt-10 text-center">
      <img src="/logo.png" alt="Quizkopp Logo" className="w-64 h-auto mx-auto mb-10 drop-shadow-md transition-transform hover:scale-105" />
      <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl space-y-4">
        <input placeholder="RAUM-CODE" className="w-full bg-slate-50 p-4 rounded-xl text-center text-2xl font-mono border border-sky-100 outline-none focus:border-[#E69F00]" value={c} onChange={e=>setC(e.target.value.toUpperCase())} maxLength={4}/>
        <input placeholder="DEIN NAME" className="w-full bg-slate-50 p-4 rounded-xl border border-sky-100 outline-none focus:border-[#E69F00]" value={n} onChange={e=>setN(e.target.value)}/>
        
        <div className="space-y-2">
            <input placeholder="NEUES TEAM (Optional)" className="w-full bg-slate-50 p-4 rounded-xl border border-sky-100 outline-none focus:border-[#E69F00]" value={t} onChange={e=>setT(e.target.value)}/>
            {c.length === 4 && existingTeams.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 justify-center">
                    <span className="text-xs text-slate-400 w-full mb-1">...oder bestehendem Team beitreten:</span>
                    {existingTeams.map(team => (
                        <button key={team} onClick={() => setT(team)} className={`px-4 py-2 text-sm font-semibold rounded-full border transition-colors ${t === team ? 'bg-[#E69F00] text-white border-[#E69F00] shadow-md' : 'bg-white text-slate-500 border-sky-200 hover:border-[#E69F00]'}`}>
                            {team}
                        </button>
                    ))}
                </div>
            )}
        </div>
        
        <button onClick={() => onJoin(c, n, t)} disabled={!c || !n} className="w-full bg-[#E69F00] text-white py-4 rounded-xl font-bold text-lg hover:bg-[#D49100] transition-colors shadow-md disabled:opacity-50 mt-4">Jetzt beitreten</button>
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
            <button onClick={() => onSelect(x)} className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold ml-auto sm:ml-2 shadow-md w-full sm:w-auto">Spielen</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function HostSetup({ onCreate, onBack, db, initialQuiz }) {
  const [title, setTitle] = useState(initialQuiz ? initialQuiz.title : '');
  const [allowJokers, setAllowJokers] = useState(initialQuiz ? initialQuiz.allowJokers !== false : true);
  const [qs, setQs] = useState(initialQuiz ? initialQuiz.questions : [{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:0,imgUrl:'',showImg:true, showAnswers: true, isJoker: false, note: ''}]);
  
  const fileInputRef = useRef(null);

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
      await updateDoc(doc(db, 'quiz_templates', initialQuiz.id), { title, questions: qs, allowJokers });
      alert("Quiz erfolgreich aktualisiert!");
    } else {
      await setDoc(doc(collection(db,'quiz_templates')), { title, questions: qs, allowJokers, createdAt: Date.now() });
      alert("Quiz neu gespeichert!");
    }
  };

  const downloadCsvTemplate = () => {
    // HEADER WURDE UM NOTIZ ERWEITERT
    const headers = "Typ;Frage;Option 1;Option 2;Option 3;Option 4;Lösung;Timer;Bild/Video/Audio URL;Notiz\n";
    const example1 = "multiple;Wie hoch ist der Eiffelturm?;300m;330m;350m;400m;2;30;;Der Eiffelturm wurde 1889 zur Weltausstellung erbaut.\n";
    const example2 = "text;Wer schrieb Faust?;-;-;-;-;Goethe;30;;\n";
    const example3 = "estimation;Wie alt wurde die älteste Schildkröte?;-;-;-;-;188;30;;\n";
    const example4 = "buzzer;Erkenne dieses Lied (Audio läuft über Beamer);-;-;-;-;Queen - Bohemian Rhapsody;0;/song1.mp3;\n";
    const example5 = "break;Ende von Runde 1 - Zwischenstand!;-;-;-;-;-;0;;\n";
    
    const csvContent = "\uFEFF" + headers + example1 + example2 + example3 + example4 + example5;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Quizkopp_Vorlage.csv"; a.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r\n|\n|\r/);
      const newQuestions = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(';');
        if (cols.length < 2) continue; 

        const type = cols[0].toLowerCase();
        if (!['multiple', 'text', 'estimation', 'buzzer', 'break'].includes(type)) continue;

        const parsedQ = {
          type: type,
          q: cols[1] || "",
          options: [cols[2] || "", cols[3] || "", cols[4] || "", cols[5] || ""],
          correctIndex: parseInt(cols[6]) - 1 || 0,
          correctValue: cols[6] || "",
          timer: parseInt(cols[7]) || 0,
          imgUrl: cols[8] || "",
          showImg: true,
          showAnswers: true,
          isJoker: false,
          note: cols[9] || "" // NEU: NOTIZ FELD AUS CSV ÜBERNEHMEN
        };

        newQuestions.push(parsedQ);
      }

      if (newQuestions.length > 0) {
        setQs(newQuestions);
        alert(`${newQuestions.length} Fragen erfolgreich importiert!`);
      } else {
        alert("Keine gültigen Fragen gefunden. Bitte Format prüfen!");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file, "UTF-8");
  };

  return (
    <div className="space-y-6">
      
      <div className="bg-sky-50 border border-sky-100 p-4 rounded-2xl flex flex-wrap gap-4 items-center justify-between shadow-inner mb-8">
        <div>
            <p className="text-sm font-bold text-slate-600 mb-1">Fragen per Excel/CSV importieren</p>
            <button onClick={downloadCsvTemplate} className="text-xs text-sky-600 hover:text-sky-800 underline">Vorlage herunterladen</button>
        </div>
        <div className="flex gap-2">
            <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" id="csv-upload" />
            <label htmlFor="csv-upload" className="cursor-pointer bg-white px-4 py-2 rounded-xl border border-sky-200 text-sky-700 font-semibold text-sm hover:bg-sky-100 transition-colors flex items-center gap-2 shadow-sm">
                <Upload size={16} /> CSV Hochladen
            </label>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-white p-6 rounded-3xl border border-sky-100 shadow-sm">
        <input placeholder="Quiz-Name" className="bg-transparent text-2xl font-bold border-b border-sky-200 flex-1 outline-none w-full" value={title} onChange={e=>setTitle(e.target.value)}/>
        <div className="flex items-center gap-4 flex-wrap w-full sm:w-auto">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-600 bg-amber-50 px-4 py-2 rounded-xl border border-amber-200 w-full sm:w-auto justify-between">
                <label>🌟 Joker-Modus für dieses Quiz?</label>
                <input type="checkbox" className="w-5 h-5 accent-amber-500" checked={allowJokers} onChange={e=>setAllowJokers(e.target.checked)}/>
            </div>
            <button onClick={saveToLib} className="bg-white p-3 rounded-xl border border-sky-100 shadow-sm flex items-center justify-center gap-2 text-slate-600 font-bold hover:bg-slate-50 transition-colors w-full sm:w-auto">
                <Save size={20} className="text-[#E69F00]"/> {initialQuiz ? 'Aktualisieren' : 'Speichern'}
            </button>
        </div>
      </div>
      
      {qs.map((q,i) => (
        <div key={i} className="bg-white p-6 rounded-3xl border border-sky-100 shadow-md space-y-4">
          <div className="flex gap-4">
            <input placeholder={q.type === 'break' ? "Titel der Pause (z.B. Zwischenstand nach Runde 1)" : "Frage..."} className="flex-1 bg-slate-50 p-2 rounded border border-sky-50" value={q.q} onChange={e=>update(i,'q',e.target.value)}/>
            
            <select className="bg-slate-50 p-2 rounded border border-sky-50 text-slate-700" value={q.type} onChange={e=>update(i,'type',e.target.value)}>
              <option value="multiple">Multiple Choice</option>
              <option value="text">Freitext</option>
              <option value="estimation">Schätzung</option>
              <option value="buzzer">Buzzer-Frage</option>
              <option value="break">⏸️ Pause / Zwischenstand</option>
            </select>
            
            <button onClick={() => removeQ(i)} className="p-2 bg-red-50 text-red-400 hover:bg-red-500 hover:text-white rounded border border-red-100 transition-colors" title="Löschen"><Trash2 size={20}/></button>
          </div>
          
          {q.type !== 'break' && (
            <div className="flex gap-4 items-center flex-wrap">
              <input placeholder="Bild / YouTube / MP3 URL (optional)" className="flex-1 min-w-[200px] bg-slate-50 p-2 rounded border border-sky-50 text-xs" value={q.imgUrl} onChange={e=>update(i,'imgUrl',e.target.value)}/>
              <div className="flex items-center gap-2 text-xs text-slate-400"><label>Auf Handy?</label><input type="checkbox" checked={q.showImg} onChange={e=>update(i,'showImg',e.target.checked)}/></div>
              
              {allowJokers && (
                <div className="flex items-center gap-2 text-xs text-amber-500 font-bold border-l border-amber-100 pl-4 ml-2 bg-amber-50 pr-2 py-1 rounded-md">
                    <label>🌟 Joker hier erlauben?</label>
                    <input type="checkbox" checked={q.isJoker} onChange={e=>update(i,'isJoker',e.target.checked)}/>
                </div>
              )}

              {q.type !== 'text' && q.type !== 'buzzer' && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 border-l border-sky-100 pl-4 ml-2">
                      <label>Antworten auf Beamer zeigen?</label>
                      <input type="checkbox" checked={q.showAnswers !== false} onChange={e=>update(i,'showAnswers',e.target.checked)}/>
                  </div>
              )}

              {q.type !== 'buzzer' && (
                <div className="flex items-center gap-2 ml-auto">
                  <Clock size={16} className="text-[#E69F00]"/><input type="number" min="0" className="w-16 bg-slate-50 p-2 rounded border border-sky-50" value={q.timer} onChange={e=>update(i,'timer',parseInt(e.target.value) || 0)}/>
                </div>
              )}
            </div>
          )}
          
          {q.type==='multiple' && <div className="grid grid-cols-2 gap-2">{q.options.map((o,oi)=>(
            <div key={oi} className={`flex gap-2 p-2 rounded border ${q.correctIndex == oi ? 'border-emerald-200 bg-emerald-50' : 'bg-slate-50 border-sky-50'}`}><input type="radio" checked={q.correctIndex==oi} onChange={()=>update(i,'correctIndex',oi)}/><input className="bg-transparent w-full text-slate-700" value={o} onChange={e=>{const no=[...q.options];no[oi]=e.target.value;update(i,'options',no)}}/></div>
          ))}</div>}
          
          {q.type !== 'multiple' && q.type !== 'break' && (
            <input type={q.type==='estimation'?'number':'text'} className="w-full bg-slate-50 p-2 rounded border border-sky-50 text-slate-700" value={q.correctValue} onChange={e=>update(i,'correctValue',e.target.value)} placeholder={q.type === 'estimation' ? "Korrekte Zahl..." : "Korrekte Lösung (für dich zur Info)..."} />
          )}

          {/* NEU: NOTIZ FELD */}
          {q.type !== 'break' && (
            <textarea placeholder="Optional: Hintergrundinfo / Fun Fact zur Auflösung..." className="w-full bg-slate-50 p-3 rounded-xl border border-sky-50 text-slate-700 text-sm mt-4 resize-none h-20 outline-none focus:border-sky-200" value={q.note || ''} onChange={e=>update(i,'note',e.target.value)} />
          )}
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={()=>setQs([...qs,{type:'multiple',q:'',options:['','','',''],correctIndex:0,correctValue:'',timer:0,imgUrl:'',showImg:true, showAnswers: true, isJoker: false, note: ''}])} className="flex-1 bg-white py-3 rounded-2xl border border-sky-100 font-bold shadow-sm text-slate-500">+ Frage hinzufügen</button>
        <button onClick={()=>onCreate(qs, allowJokers)} className="flex-1 bg-emerald-500 text-white py-3 rounded-2xl font-bold shadow-lg">Quiz starten</button>
      </div>
    </div>
  );
}

function HostDashboard({ room, players, onReveal, onNext, onCorrect, onBuzzerCorrect }) {
  const q = room.questions[room.currentQuestionIndex];
  const isLastQuestion = room.currentQuestionIndex >= room.questions.length - 1;
  const sortedTeams = getSortedTeams(players, room);
  
  const [showBuzzerAnswer, setShowBuzzerAnswer] = useState(false);
  const [numTeams, setNumTeams] = useState(2); 

  useEffect(() => {
    setShowBuzzerAnswer(false);
  }, [room.currentQuestionIndex]);

  const generateRandomTeams = async () => {
    if (players.length === 0) return alert("Es sind noch keine Spieler im Raum!");
    if (window.confirm(`Alle Spieler jetzt zufällig auf ${numTeams} Teams aufteilen?`)) {
      const shuffled = [...players].sort(() => 0.5 - Math.random());
      const batch = writeBatch(db);
      
      shuffled.forEach((p, index) => {
        const teamIndex = (index % numTeams) + 1;
        batch.update(doc(db, 'players', p.id), { team: `Team ${teamIndex}` });
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
        teams[tId].sum += parseFloat(p.currentAnswer);
        teams[tId].count++;
        if (p.wasCorrect) teams[tId].isWinner = true; 
    });

    const target = parseFloat(q.correctValue);

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

  if (room.status === 'lobby') return (
    <div className="text-center py-20 space-y-12 relative h-full">
      <p className="text-3xl text-slate-400 uppercase tracking-widest font-bold">Raum-Code</p>
      <h2 className="text-[10rem] leading-none font-mono font-bold text-[#E69F00] tracking-widest">{room.id}</h2>
      <div className="bg-white p-8 rounded-3xl border border-sky-100 max-w-4xl mx-auto shadow-xl">
        <h3 className="mb-8 font-bold flex items-center justify-center gap-3 text-3xl text-slate-700"><Users size={36}/> Teams ({sortedTeams.length}) | Spieler ({players.length})</h3>
        <div className="flex flex-wrap gap-4 justify-center">{players.map(p=><span key={p.id} className="bg-slate-50 px-6 py-3 rounded-full text-xl font-semibold shadow-sm text-slate-600">{p.name} {p.team && <span className="text-sm font-normal text-slate-400 ml-1">({p.team})</span>}</span>)}</div>
        
        {players.length > 0 && (
          <div className="mt-12 pt-8 border-t border-sky-100">
            <h4 className="mb-4 font-bold text-xl text-slate-500">🎲 Zufällige Teams auslosen</h4>
            <div className="flex items-center justify-center gap-4">
                <span className="text-slate-400 font-medium">Anzahl Teams:</span>
                <input type="number" min="2" max="20" value={numTeams} onChange={e => setNumTeams(parseInt(e.target.value) || 2)} className="w-20 bg-slate-50 p-3 rounded-xl border border-sky-100 text-center font-bold text-lg outline-none focus:border-[#E69F00]" />
                <button onClick={generateRandomTeams} className="bg-sky-500 text-white px-6 py-3 rounded-xl font-bold shadow-md hover:bg-sky-600 transition-colors">Auslosen!</button>
            </div>
          </div>
        )}
      </div>
      <button onClick={()=>updateDoc(doc(db,'rooms',room.id),{status:'active'})} disabled={players.length===0} className="bg-emerald-500 text-white px-24 py-8 rounded-full text-4xl font-bold shadow-xl transition-all mt-10">Quiz starten!</button>
    </div>
  );
  
  if (room.status === 'finished') return (
    <div className="space-y-8 max-w-4xl mx-auto py-10 text-slate-700 relative h-full">
      <Confetti />
      <h2 className="text-center text-6xl text-[#E69F00] font-bold mb-12 relative z-10">🏆 Endstand</h2>
      {sortedTeams.map((t,i)=>(
        <div key={t.name} className={`p-8 rounded-3xl flex justify-between items-center border ${i===0?'bg-yellow-50 border-[#E69F00] shadow-md relative z-10':'bg-white border-sky-50 shadow-sm relative z-10'}`}>
          <div>
              <span className="text-3xl font-bold block">{i+1}. {t.name}</span>
              <span className="text-sm text-slate-400">{t.players.map(p => p.name).join(", ")}</span>
          </div>
          <span className="font-mono text-4xl bg-slate-50 px-6 py-2 rounded-xl text-[#E69F00]">{t.totalScore}</span>
        </div>
      ))}
      <button onClick={()=>downloadCSV(players,room)} className="w-full bg-white border border-sky-100 py-6 rounded-3xl flex items-center justify-center gap-4 text-2xl font-bold mt-12 shadow-md text-slate-700 relative z-10"><Download size={32}/> Excel-Export (CSV)</button>
    </div>
  );

  if (q.type === 'break') {
    return (
      <div className="space-y-8 max-w-4xl mx-auto py-10 text-slate-700 relative h-full">
        <h2 className="text-center text-5xl text-[#E69F00] font-bold mb-12">⏸️ {q.q || 'Zwischenstand'}</h2>
        
        <div className="bg-white p-8 rounded-3xl border border-sky-100 shadow-xl mb-8">
            <h3 className="text-2xl font-bold mb-6 text-slate-600 text-center">Aktuelles Ranking</h3>
            <div className="space-y-4">
              {sortedTeams.map((t, i) => (
                <div key={t.name} className={`flex justify-between items-center p-4 rounded-xl border ${i===0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-sky-50'}`}>
                  <span className="text-2xl font-bold text-slate-700">{i+1}. {t.name}</span>
                  <span className="font-mono text-3xl font-bold text-[#E69F00]">{t.totalScore}</span>
                </div>
              ))}
            </div>
        </div>

        <button onClick={onNext} className="w-full bg-emerald-500 text-white px-8 py-6 rounded-3xl text-3xl font-bold shadow-xl hover:scale-[1.02] transition-all">
          {isLastQuestion ? 'Ergebnisse anzeigen' : 'Nächste Runde starten'}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid lg:grid-cols-4 gap-8 h-full">
        <div className="lg:col-span-3 space-y-6 flex flex-col h-full text-slate-700">
          <div className="bg-white p-8 md:p-12 rounded-3xl border border-sky-100 shadow-2xl relative flex-grow flex flex-col">
            <div className="flex justify-between items-center mb-8">
               <div className="flex flex-wrap items-center gap-3">
                 <span className="text-lg font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-sky-50">Frage {room.currentQuestionIndex+1}/{room.questions.length}</span>
                 {room.allowJokers && (
                   <span className="text-sm font-bold text-amber-600 uppercase tracking-widest bg-amber-50 px-4 py-2 rounded-full border border-amber-200 shadow-sm">
                     🌟 {room.questions.slice(room.currentQuestionIndex).filter(qu => qu.isJoker).length} Joker-Fragen übrig
                   </span>
                 )}
               </div>
               <div className="flex gap-3 ml-auto">
                 {q.type !== 'buzzer' && <div className="flex items-center gap-3 text-[#E69F00] font-mono text-4xl font-bold bg-slate-50 px-6 py-2 rounded-full border border-sky-50"><Clock size={32}/> {room.timeLeft > 0 ? `${room.timeLeft}s` : '∞'}</div>}
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
            {q.imgUrl && getMediaType(q.imgUrl) === 'image' && (
              <img src={q.imgUrl} className="w-full max-h-[45vh] object-contain rounded-2xl mb-8 bg-slate-50 p-4 border border-sky-50"/>
            )}

            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-10 leading-tight">{q.q}</h2>

            {q.type === 'buzzer' && room.status === 'active' && room.buzzerWinner && (
              <div className="bg-red-50 border-2 border-red-500 p-12 rounded-3xl text-center shadow-2xl animate-pulse mt-auto">
                <p className="text-red-500 font-bold text-xl mb-4 uppercase tracking-widest">Schnellster Buzzer:</p>
                <h3 className="text-6xl md:text-7xl font-black text-slate-800 mb-2">{room.buzzerWinnerName}</h3>
                
                {room.buzzerReaction && (
                    <p className="text-2xl font-bold text-red-500 mb-6 flex items-center justify-center gap-2">
                        <Clock size={24}/> {(room.buzzerReaction / 1000).toFixed(2)} Sekunden
                    </p>
                )}

                {q.correctValue && (
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
            
            {room.status === 'revealed' && q.type === 'multiple' && q.showAnswers !== false && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-8 border-t border-sky-100 pt-8">
                    <div className="col-span-full"><h3 className="text-xl font-bold text-slate-600 mb-2">Wer hat was getippt?</h3></div>
                    {players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "").map(p => {
                        const pUsedJoker = p.jokerQuestion === room.currentQuestionIndex;
                        return (
                          <div key={p.id} className={`p-4 rounded-xl border-2 relative ${p.wasCorrect ? 'bg-emerald-50 border-emerald-500' : 'bg-slate-50 border-sky-100'}`}>
                              <div className="font-bold text-slate-700 flex justify-between items-center">
                                  <span>{p.name} {p.team && <span className="text-xs text-slate-400 font-normal">({p.team})</span>}</span>
                                  {pUsedJoker && <span className="text-xl" title="Joker gespielt!">🌟</span>}
                              </div>
                              <div className="text-sm mt-1">{q.options[p.currentAnswer]}</div>
                          </div>
                        )
                    })}
                </div>
            )}

            {room.status === 'revealed' && q.type === 'estimation' && q.showAnswers !== false && renderEstimationAnswers()}
            
            {room.status === 'revealed' && q.type === 'text' && <div className="space-y-4 mt-8 border-t border-sky-100 pt-8">
              <h3 className="text-xl font-bold text-slate-600 mb-4">Antworten bewerten</h3>
              {players.map(p => {
                const pUsedJoker = p.jokerQuestion === room.currentQuestionIndex;
                const mult = pUsedJoker ? 2 : 1;
                
                return (
                  <div key={p.id} className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center bg-slate-50 p-6 rounded-2xl border border-sky-50 shadow-sm">
                    <div className="pr-4">
                        <span className="text-sm font-bold text-slate-400 uppercase flex items-center gap-2">
                           {p.name} {p.team && <span className="text-xs text-slate-400">({p.team})</span>}
                           {pUsedJoker && <span className="text-amber-500 text-lg" title="Joker eingesetzt!">🌟</span>}
                        </span>
                        <p className="text-2xl italic mt-1">"{p.currentAnswer||'---'}"</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={()=>onCorrect(p.id, 0)} className={`p-4 rounded-xl shadow-sm transition-all ${p.corrected && p.currentAwardedPoints === 0 ? 'bg-red-500 text-white scale-105' : 'bg-white text-slate-300 hover:text-red-500'}`} title="0 Punkte"><XCircle size={32}/></button>
                        <button onClick={()=>onCorrect(p.id, 0.5)} className={`p-4 rounded-xl shadow-sm transition-all font-black text-2xl w-[64px] flex justify-center items-center ${p.corrected && p.currentAwardedPoints === 0.5 * mult ? 'bg-orange-400 text-white scale-105' : 'bg-white text-slate-300 hover:text-orange-400'}`} title={mult === 2 ? "0.5 Punkte (x2 Joker = 1 Punkt)" : "0.5 Punkte"}>½</button>
                        <button onClick={()=>onCorrect(p.id, 1)} className={`p-4 rounded-xl shadow-sm transition-all ${p.corrected && p.currentAwardedPoints === 1 * mult ? 'bg-emerald-500 text-white scale-105' : 'bg-white text-slate-300 hover:text-emerald-500'}`} title={mult === 2 ? "1 Punkt (x2 Joker = 2 Punkte)" : "1 Punkt"}><CheckCircle size={32}/></button>
                    </div>
                  </div>
                )
              })}
            </div>}

            {/* NEU: DIE NOTIZ / FUN FACT ANZEIGE AUF DEM HOST BILDSCHIRM */}
            {room.status === 'revealed' && q.note && (
              <div className="bg-blue-50 border border-blue-200 p-8 rounded-2xl mb-6 mt-6 shadow-inner">
                <p className="text-blue-600 font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                   <MessageSquare size={20}/> Hintergrundinfo / Fun Fact
                </p>
                <p className="text-xl font-medium text-slate-700 leading-relaxed whitespace-pre-line">{q.note}</p>
              </div>
            )}
          </div>

          {(q.type !== 'buzzer' || room.status === 'revealed') && (
            <button onClick={room.status === 'active' ? onReveal : onNext} className={`w-full py-8 rounded-3xl font-bold text-3xl shadow-xl transition-all hover:scale-[1.02] ${room.status === 'active' ? 'bg-[#E69F00] text-white' : 'bg-emerald-500 text-white'}`}>
              {room.status === 'active' ? 'Lösung' : (isLastQuestion ? 'Ergebnisse anzeigen' : 'Nächste Frage')}
            </button>
          )}
        </div>
        
        <div className="bg-white p-8 rounded-3xl border border-sky-100 h-fit sticky top-24 shadow-xl">
          <h3 className="text-2xl font-bold mb-8 uppercase tracking-widest text-slate-300">Team Ranking</h3>
          <div className="space-y-4">
              {sortedTeams.map((t, index) => (
                <div key={t.name} className="bg-slate-50 rounded-xl border border-sky-50 shadow-sm overflow-hidden">
                  <div className="flex justify-between items-center p-4 bg-sky-50/50">
                    <span className="font-bold flex items-center gap-3 text-slate-700">
                      <span className="text-slate-400 text-sm">{index + 1}.</span>
                      {t.name}
                    </span>
                    <span className="font-mono font-bold bg-white px-3 py-1 rounded-lg border border-sky-100 text-[#E69F00] shadow-inner">
                      {t.totalScore}
                    </span>
                  </div>
                  {t.players.length > 0 && (
                    <div className="px-4 py-2 bg-white space-y-2 border-t border-sky-50">
                      {t.players.map(p => {
                        const isReadyOrCorrect = room.status === 'revealed' ? p.wasCorrect === true : ((p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== "") || p.id === room.buzzerWinner);
                        
                        return (
                          <div key={p.id} className="flex justify-between text-sm items-center">
                            <span className="text-slate-500 pl-6">{p.name}</span>
                            <div className="flex items-center gap-4">
                              {isReadyOrCorrect ? <CheckCircle size={14} className="text-emerald-500"/> : <div className="w-2 h-2 rounded-full bg-slate-200 animate-pulse mt-1"/>}
                              <span className="font-mono text-xs text-slate-400">{p.score}</span>
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

      <div className="fixed bottom-6 right-6 bg-white px-6 py-3 rounded-2xl shadow-2xl border border-sky-100 flex items-center gap-3 z-50">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Raum-Code</span>
        <span className="font-mono text-2xl font-bold text-[#E69F00]">{room.id}</span>
      </div>
    </>
  );
}

function PlayerDashboard({ room, player, players, onAnswer, onBuzz, onUseJoker }) {
  if (!player) return null;
  const q = room.questions[room.currentQuestionIndex];
  
  const [v, setV] = useState('');
  const [qStartTime, setQStartTime] = useState(Date.now());
  const sortedTeams = getSortedTeams(players, room);
  
  useEffect(() => {
    setV('');
    setQStartTime(Date.now()); 
  }, [room.currentQuestionIndex]);
  
  const hasAnswered = player.currentAnswer !== null && player.currentAnswer !== undefined && player.currentAnswer !== "";
  const timeIsUp = q.timer > 0 && room.timeLeft === 0 && room.status === 'active';
  const isJokerActiveNow = player.jokerQuestion === room.currentQuestionIndex;

  const handleBuzzClick = () => {
    try {
        const audio = new Audio('/buzzer.mp3');
        audio.play().catch(e => console.log("Sound konnte nicht abgespielt werden:", e));
    } catch(err) {}
    const reactionTimeMs = Date.now() - qStartTime;
    onBuzz(reactionTimeMs);
  };

  if (room.status === 'lobby') return (
    <div className="text-center py-20 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-sm mx-auto text-slate-700">
      <h2 className="text-2xl font-bold">Hallo {player.name}!</h2>
      {player.team && <div className="mt-4 text-lg font-bold text-sky-600 bg-sky-50 inline-block px-6 py-2 rounded-full border border-sky-100">Dein Team: {player.team}</div>}
      <p className="mt-8 animate-pulse text-[#E69F00]">Warte auf Start...</p>
    </div>
  );
  
  if (room.status === 'finished') {
    const myTeamId = player.team && player.team.trim() !== "" ? player.team.trim() : player.name;
    const myTeam = sortedTeams.find(t => t.name === myTeamId);
    const myRank = sortedTeams.findIndex(t => t.name === myTeamId) + 1;
    
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

  if (q.type === 'buzzer') {
    return (
      <div className="max-w-md mx-auto space-y-6 text-center text-slate-700">
        <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
            <span>Frage {room.currentQuestionIndex+1}</span>
            <span className="text-[#E69F00]">Persönliche Punkte: {player.score}</span>
        </div>
        
        {q.imgUrl && q.showImg && getMediaType(q.imgUrl) === 'image' && <img src={q.imgUrl} className="w-full h-40 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 mb-6"/>}
        {q.imgUrl && q.showImg && (getMediaType(q.imgUrl) === 'youtube' || getMediaType(q.imgUrl) === 'audio') && (
           <div className="w-full h-32 bg-slate-800 rounded-xl flex flex-col items-center justify-center text-sky-400 shadow-sm mb-6 border border-slate-700">
              <Play size={32} className="mb-2 opacity-50"/>
              <span className="text-sm font-bold uppercase tracking-widest">Achtung Beamer</span>
              <span className="text-xs text-slate-400 mt-1">Audio / Video läuft beim Quizmaster</span>
           </div>
        )}

        <h2 className="text-2xl font-bold mb-6">{q.q}</h2>

        {renderJokerArea()}
        
        {room.status === 'active' && !room.buzzerWinner && (
            <button onClick={handleBuzzClick} className="w-64 h-64 rounded-full bg-red-600 border-8 border-red-800 shadow-[0_10px_0_#7f1d1d,0_0_50px_rgba(220,38,38,0.3)] active:translate-y-[10px] active:shadow-none transition-all mx-auto flex items-center justify-center mt-8">
                <span className="text-4xl font-black text-white">BUZZER</span>
            </button>
        )}
        
        {room.status === 'active' && room.buzzerWinner && room.buzzerWinner === player.id && <div className="py-12 bg-red-50 rounded-3xl border-2 border-red-500 animate-pulse text-3xl font-bold text-red-500 mt-8">DU BIST DRAN!</div>}
        
        {/* NEU: GROSSE LÖSUNGSANZEIGE & NOTIZ FÜR BUZZER AUF SPIELER HANDY */}
        {room.status === 'revealed' && typeof player.wasCorrect === 'boolean' && (
            <div className="mt-8 space-y-4">
                <div className={`py-10 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-50 border-emerald-500 text-emerald-500':'bg-red-50 border-red-500 text-red-500'}`}>
                    <h3 className="text-2xl font-bold">{player.wasCorrect ? (isJokerActiveNow ? '🌟 2 Punkte für euch!' : 'Punkt für euch!') : 'Leider kein Punkt.'}</h3>
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
        <span>Frage {room.currentQuestionIndex+1}</span>
        {q.isJoker && <span className="text-amber-500 font-black animate-pulse bg-amber-50 px-2 py-1 rounded">🌟 2 PUNKTE</span>}
        {q.timer === 0 && <span className="flex items-center gap-1 text-[#E69F00]"><Clock size={12}/> ∞</span>}
      </div>

      {q.timer > 0 && room.status === 'active' && !timeIsUp && (
        <div className="flex justify-center my-4">
           <div className={`flex items-center gap-3 px-8 py-3 rounded-full border-4 shadow-lg font-mono text-4xl font-bold transition-all duration-300 ${room.timeLeft <= 5 ? 'bg-red-50 border-red-500 text-red-600 animate-pulse scale-110' : 'bg-white border-sky-100 text-[#E69F00]'}`}>
              <Clock size={36}/> {room.timeLeft}s
           </div>
        </div>
      )}

      <h2 className="text-2xl font-bold leading-tight mb-2">{q.q}</h2>
      
      {q.imgUrl && q.showImg && getMediaType(q.imgUrl) === 'image' && <img src={q.imgUrl} className="w-full h-48 object-contain rounded-xl bg-slate-50 p-2 border border-sky-50 shadow-sm"/>}
      {q.imgUrl && q.showImg && (getMediaType(q.imgUrl) === 'youtube' || getMediaType(q.imgUrl) === 'audio') && (
         <div className="w-full h-32 bg-slate-800 rounded-xl flex flex-col items-center justify-center text-sky-400 shadow-sm mb-6 border border-slate-700">
            <Play size={32} className="mb-2 opacity-50"/>
            <span className="text-sm font-bold uppercase tracking-widest">Achtung Beamer</span>
            <span className="text-xs text-slate-400 mt-1">Audio / Video läuft beim Quizmaster</span>
         </div>
      )}

      {renderJokerArea()}
      
      {room.status === 'active' && !hasAnswered && !timeIsUp && (
        <div className="space-y-3 pt-2">
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
      
      {/* NEU: GROSSE LÖSUNGSANZEIGE & NOTIZ AUF SPIELER HANDY (Standard Runden) */}
      {room.status === 'revealed' && (q.type !== 'text' || player.corrected) && typeof player.wasCorrect === 'boolean' && (
         <div className="mt-8 space-y-4">
             <div className={`py-10 rounded-3xl border-2 text-center ${player.wasCorrect?'bg-emerald-50 border-emerald-500 text-emerald-500':'bg-red-50 border-red-500 text-red-500'}`}>
                 <h3 className="text-2xl font-bold">{player.wasCorrect ? (isJokerActiveNow ? '🌟 2 Punkte für euch!' : 'Punkt für euch!') : 'Leider kein Punkt.'}</h3>
                 
                 <div className="mt-6">
                     <span className="text-xs uppercase font-bold tracking-widest opacity-70 block mb-2 text-slate-500">Richtige Lösung:</span>
                     <span className="text-2xl font-black bg-white px-6 py-3 rounded-xl shadow-sm border border-slate-200 inline-block text-slate-800">
                         {q.type === 'multiple' ? q.options[q.correctIndex] : q.correctValue}
                     </span>
                 </div>
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