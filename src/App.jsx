import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { LogOut, Maximize, Mic, Trophy, Volume2, VolumeX } from 'lucide-react';
import { ADMIN_PASSWORD, auth, db } from './firebase';
import { cleanupOldData, deleteRoomWithPlayers, generateRoomCode, getOrderPoints, getSortedTeams, getTeamStyleIndex, isInfoItem, toggleFullscreen } from './lib/helpers';
import { Sound } from './lib/sound';
import { AdminLogin, AdminPanel, Library, LoginView } from './views/AdminViews';
import { HostSetup } from './views/Editor';
import { HostDashboard } from './views/HostDashboard';
import { ObserverDashboard } from './views/ObserverDashboard';
import { PlayerDashboard } from './views/PlayerDashboard';

// --- HAUPT-APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); 
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [adminAuth, setAdminAuth] = useState(false);
  
  const [editingQuiz, setEditingQuiz] = useState(null); 
  const [moderatorMode, setModeratorMode] = useState(() => { try { return localStorage.getItem('quizkopp-moderator') === 'on'; } catch (e) { return false; } });
  const toggleModerator = () => {
    const next = !moderatorMode;
    setModeratorMode(next);
    try { localStorage.setItem('quizkopp-moderator', next ? 'on' : 'off'); } catch (e) {}
  };
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem('quizkopp-sound') !== 'off'; } catch (e) { return true; } });
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem('quizkopp-sound', next ? 'on' : 'off'); } catch (e) {}
    if (next) { Sound.unlock(); Sound.pop(); }
  };

  useEffect(() => {
    signInAnonymously(auth);
    return onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
  }, []);

  // Nur den aktuellen Raum und seine Spieler laden – nicht mehr alle Räume & Spieler, die es je gab
  useEffect(() => {
    if (!user || !currentRoomCode) { setActiveRoom(null); setRoomPlayers([]); setRoomMissing(false); return; }
    let seen = false;
    const unsubR = onSnapshot(doc(db, 'rooms', currentRoomCode), snap => {
      if (snap.exists()) { seen = true; setRoomMissing(false); setActiveRoom({ id: snap.id, ...snap.data() }); }
      else { setActiveRoom(null); if (seen) setRoomMissing(true); }
    });
    const unsubP = onSnapshot(query(collection(db, 'players'), where('roomCode', '==', currentRoomCode)), s => setRoomPlayers(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsubR(); unsubP(); };
  }, [user, currentRoomCode]);

  const players = [...roomPlayers].sort((a,b) => b.score - a.score);
  const myProfile = roomPlayers.find(p => p.id === user?.uid);

  const roomExists = async (code) => (await getDoc(doc(db, 'rooms', code))).exists();
  const leaveRoom = () => { setRole(null); setCurrentRoomCode(''); setRoomMissing(false); };

  useEffect(() => {
    let interval;
    if (role === 'host' && activeRoom?.status === 'active' && activeRoom?.timeLeft > 0 && !activeRoom?.buzzerWinner && !activeRoom?.timerPaused) {
      interval = setInterval(async () => {
        const newTime = activeRoom.timeLeft - 1;
        await updateDoc(doc(db, 'rooms', currentRoomCode), { timeLeft: newTime });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [role, activeRoom?.status, activeRoom?.timeLeft, activeRoom?.buzzerWinner, activeRoom?.timerPaused]);

  const createRoom = async (questions, allowJokers = true) => {
    const code = generateRoomCode();
    await setDoc(doc(db, 'rooms', code), {
      hostId: user.uid, status: 'lobby', currentQuestionIndex: 0, currentStepIndex: 0, questions,
      timeLeft: questions[0].timer || 0, buzzerWinner: null, buzzerLockedOut: [], teamScores: {}, allowJokers: allowJokers, createdAt: Date.now()
    });
    setCurrentRoomCode(code); setRole('host');
    cleanupOldData(code); // im Hintergrund
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
        currentAwardedPoints: finalPoints,
        [`awarded.${activeRoom.currentQuestionIndex}`]: finalPoints // merken, damit "Zurück" keine Punkte doppelt vergibt
    });
  };

  // Einen Schritt zurück – ohne neu zu werten: Fragen erscheinen wieder aufgelöst, Antworten & Punkte werden wiederhergestellt
  const goPrev = async () => {
    const r = activeRoom;
    if (!r) return;
    const roomRef = doc(db, 'rooms', currentRoomCode);
    if (r.status === 'finished') {
      const cur = r.questions[r.currentQuestionIndex];
      await updateDoc(roomRef, { status: isInfoItem(cur) ? 'active' : 'revealed', podiumStep: 0 });
      return;
    }
    const prevIdx = r.currentQuestionIndex - 1;
    if (prevIdx < 0) return;
    const pq = r.questions[prevIdx];
    const info = isInfoItem(pq);
    const batch = writeBatch(db);
    for (const p of players) {
      const awarded = p.awarded?.[prevIdx];
      batch.update(doc(db, 'players', p.id), {
        currentAnswer: info ? null : (p.answers?.[prevIdx] ?? null),
        corrected: !info && awarded !== undefined,
        wasCorrect: info || awarded === undefined ? null : awarded > 0,
        currentAwardedPoints: awarded ?? 0,
        isBullseye: false,
        stepLockedIn: null
      });
    }
    batch.update(roomRef, {
      currentQuestionIndex: prevIdx,
      status: info ? 'active' : 'revealed',
      currentStepIndex: pq.type === 'step' ? Math.max(0, (pq.steps || []).length - 1) : 0,
      timeLeft: 0,
      timerPaused: false,
      buzzerWinner: null,
      buzzerReaction: null,
      buzzerLockedOut: [],
      geoStage: pq.type === 'geo' ? 'target' : null
    });
    await batch.commit();
  };

  const handleBuzzerWrongContinue = async () => {
    const pId = activeRoom.buzzerWinner;
    const buzzingPlayer = players.find(p => p.id === pId);
    if (!buzzingPlayer) return;

    const buzzingTeamId = buzzingPlayer.team && buzzingPlayer.team.trim() !== "" ? buzzingPlayer.team.trim() : buzzingPlayer.name;
    const teamMemberIds = players.filter(p => {
        const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
        return tId === buzzingTeamId;
    }).map(p => p.id);

    const currentLockedOut = activeRoom.buzzerLockedOut || [];
    const newLockedOut = [...new Set([...currentLockedOut, ...teamMemberIds])];

    await updateDoc(doc(db, 'rooms', currentRoomCode), {
        buzzerWinner: null,
        buzzerReaction: null,
        buzzerLockedOut: newLockedOut
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

  const revealAnswer = async (liveEstValue = null) => {
    if(!activeRoom) return;
    const questionsCopy = [...activeRoom.questions];
    const q = questionsCopy[activeRoom.currentQuestionIndex];
    const batch = writeBatch(db);

    if (q.type === 'estimation') {
      const finalValue = liveEstValue !== null ? liveEstValue : q.correctValue;
      const parsedFinal = parseFloat(String(finalValue).replace(',', '.'));
      
      if (finalValue === "" || isNaN(parsedFinal)) {
          alert("Bitte trage eine gültige Zahl als Lösung ein (z.B. nach dem Wiegen)!");
          return; 
      }
      q.correctValue = String(parsedFinal);
      batch.update(doc(db, 'rooms', currentRoomCode), { questions: questionsCopy });
    }

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
        const target = parseFloat(String(q.correctValue).replace(',', '.'));
        const teams = {};
        for (const p of validPlayers) {
          const tId = p.team && p.team.trim() !== "" ? p.team.trim() : p.name;
          if (!teams[tId]) teams[tId] = { sum: 0, count: 0 };
          teams[tId].sum += parseFloat(String(p.currentAnswer).replace(',', '.'));
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
          batch.update(doc(db, 'players', p.id), { 
              wasCorrect: isCorrect,
              isBullseye: isCorrect && isBullseye
          });
        }
      } else {
         for (const p of players) batch.update(doc(db, 'players', p.id), { wasCorrect: false });
      }
    } else if (q.type === 'geo') {
      for (const p of players) batch.update(doc(db, 'players', p.id), { wasCorrect: false });
    } else if (q.type === 'order') {
      for (const p of players) {
        const ans = Array.isArray(p.currentAnswer) ? p.currentAnswer : null;
        const base = ans ? getOrderPoints(q, ans) : 0;
        const pts = base * (p.jokerQuestion === activeRoom.currentQuestionIndex ? 2 : 1);
        batch.update(doc(db, 'players', p.id), { score: p.score + pts, wasCorrect: pts > 0, currentAwardedPoints: pts, [`awarded.${activeRoom.currentQuestionIndex}`]: pts });
      }
    }
    
    // Geo: Schritt 1 zeigt nur die Tipps aller Spieler, das Ziel kommt im zweiten Schritt
    batch.update(doc(db, 'rooms', currentRoomCode), { status: 'revealed', ...(q.type === 'geo' ? { geoStage: 'pins' } : {}) });
    await batch.commit();
  };

  if (loading) return <div className="min-h-screen bg-[#F0F9FF] flex items-center justify-center text-[#1E293B] font-bold">Lade Quizkopp...</div>;

  const isSpecialView = role === 'beamer' || role === 'observer';

  return (
    <div className="min-h-screen bg-[#F0F9FF] text-[#1E293B] font-sans">
      <header className="bg-white border-b border-sky-100 p-4 sticky top-0 z-10 shadow-sm">
        <div className={(role === 'host' || role === 'beamer' || role === 'setup') ? "w-full max-w-[1920px] mx-auto px-4 flex justify-between items-center" : "max-w-4xl mx-auto flex justify-between items-center"}>
          <div className="flex items-center gap-2">
              <Trophy className="text-[#E69F00]"/>
              <h1 className="text-xl font-bold italic">
                  Die Quizkopp App 
                  {role === 'beamer' && <span className="text-slate-300 font-normal ml-2">| Beamer</span>}
                  {role === 'observer' && <span className="text-slate-300 font-normal ml-2">| Zuschauer</span>}
              </h1>
          </div>
          <div className="flex items-center gap-4">
          {role === 'host' && <button onClick={toggleModerator} className={`flex items-center gap-1 text-sm font-bold px-3 py-1 rounded-full transition-colors ${moderatorMode ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-sky-500'}`} title="Moderatoren-Ansicht: Lösung, Notizen & Vorschau – der Beamer läuft in einem eigenen Fenster"><Mic size={18}/> <span className="hidden md:inline">{moderatorMode ? 'Moderation an' : 'Moderation'}</span></button>}
          {(role === 'host' || role === 'beamer') && <button onClick={toggleSound} className="text-slate-400 hover:text-sky-500 transition-colors" title={soundOn ? 'Sound ausschalten' : 'Sound einschalten'}>{soundOn ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button>}
          {(role === 'host' || role === 'beamer') && <button onClick={toggleFullscreen} className="text-slate-400 hover:text-sky-500 transition-colors" title="Vollbild an/aus"><Maximize size={20}/></button>}
          {role && <button onClick={() => { if(role==='host' && currentRoomCode) { if (!window.confirm('Quiz wirklich beenden? Der Raum wird für alle geschlossen.')) return; deleteRoomWithPlayers(currentRoomCode).catch(console.error); } leaveRoom(); }} className="text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20}/></button>}
          </div>
        </div>
      </header>

      <main className={(role === 'host' || role === 'beamer') ? "w-full max-w-[1920px] mx-auto p-4 lg:p-8 relative" : role === 'setup' ? "w-full max-w-7xl mx-auto p-4 lg:p-8 relative" : "max-w-4xl mx-auto p-4 py-8 relative"}>
        {!role && !adminAuth && <LoginView onJoin={async (c, n, t, styleIdx) => {
            const roomCode = c.toUpperCase();
            const playerName = n.trim();
            if(!(await roomExists(roomCode))) return alert("Raum nicht gefunden!");
            
            const sameRoom = await getDocs(query(collection(db, 'players'), where('roomCode', '==', roomCode)));
            const roomPlayers = sameRoom.docs.map(d => ({ id: d.id, ...d.data() }));
            const existingPlayer = roomPlayers.find(p => (p.name || '').toLowerCase() === playerName.toLowerCase());
            // Tritt man einem bestehenden Team bei, übernimmt man dessen Tier – sonst das gewählte
            const teamName = (t || '').trim();
            const teamMate = teamName && roomPlayers.find(p => (p.team || '').trim() === teamName && p.id !== existingPlayer?.id);
            const teamStyle = teamMate ? getTeamStyleIndex(teamName, roomPlayers) : (Number.isInteger(styleIdx) ? styleIdx : null);
            
            if (existingPlayer) {
                if (existingPlayer.id !== user.uid) {
                    const { id, ...oldData } = existingPlayer; 
                    await deleteDoc(doc(db, 'players', existingPlayer.id));
                    await setDoc(doc(db, 'players', user.uid), { ...oldData, team: t, teamStyle });
                } else {
                    await updateDoc(doc(db, 'players', user.uid), { team: t, teamStyle });
                }
            } else {
                await setDoc(doc(db,'players',user.uid),{name:playerName, team:t, teamStyle, roomCode:roomCode, score:0, currentAnswer:null, answers:{}, jokerUsed: false, jokerQuestion: null, isBullseye: false, stepLockedIn: null});
            }
            setCurrentRoomCode(roomCode); setRole('player');
        }} onAdmin={() => setAdminAuth('login')} onJoinBeamer={async (c) => {
            const roomCode = c.toUpperCase();
            if(!(await roomExists(roomCode))) return alert("Raum nicht gefunden!");
            setCurrentRoomCode(roomCode); setRole('beamer');
        }} onJoinObserver={async (c) => {
            const roomCode = c.toUpperCase();
            if(!(await roomExists(roomCode))) return alert("Raum nicht gefunden!");
            setCurrentRoomCode(roomCode); setRole('observer');
        }} />}

        {adminAuth === 'login' && <AdminLogin onOk={pw => pw === ADMIN_PASSWORD ? setAdminAuth(true) : alert("Falsch!")} onBack={() => setAdminAuth(false)}/>}
        
        {adminAuth === true && !role && <AdminPanel onNew={() => { setEditingQuiz(null); setRole('setup'); }} onLib={() => setRole('lib')} onLogout={() => setAdminAuth(false)}/>}
        
        {role === 'setup' && <HostSetup onCreate={createRoom} onBack={() => setRole(null)} db={db} initialQuiz={editingQuiz} />}
        
        {role === 'lib' && <Library onSelect={x => createRoom(x.questions, x.allowJokers)} onEdit={quiz => { setEditingQuiz(quiz); setRole('setup'); }} onBack={() => setRole(null)} db={db}/>}

        {(role === 'host' || role === 'beamer') && activeRoom && <HostDashboard room={activeRoom} players={players} isBeamer={role === 'beamer'} onReveal={revealAnswer} onNext={async () => {
            const last = activeRoom.currentQuestionIndex >= activeRoom.questions.length -1;
            const nextIdx = activeRoom.currentQuestionIndex + 1;
            const curQ = activeRoom.questions[activeRoom.currentQuestionIndex];
            const batch = writeBatch(db);
            for(const p of players) {
              batch.update(doc(db,'players',p.id),{currentAnswer:null, corrected:false, wasCorrect:null, currentAwardedPoints:0, isBullseye: false, stepLockedIn: null});
            }
            batch.update(doc(db,'rooms',currentRoomCode),{
              status:last?'finished':'active',
              currentQuestionIndex:last?activeRoom.currentQuestionIndex:nextIdx,
              currentStepIndex: 0,
              timeLeft:activeRoom.questions[nextIdx]?.timer || 0, 
              buzzerWinner: null, 
              buzzerReaction: null,
              buzzerLockedOut: [],
              geoStage: null,
              timerPaused: false,
              ...(last ? { podiumStep: 0 } : {}),
              // Stand beim Zwischenstand merken – der nächste Zwischenstand animiert von hier aus
              ...(curQ?.type === 'break' ? { lastRanking: getSortedTeams(players, activeRoom).map(t => ({ name: t.name, score: t.totalScore })) } : {})
            });
            await batch.commit();
        }} onPrev={goPrev} soundOn={soundOn && !(role === 'host' && moderatorMode)} moderatorMode={moderatorMode} onCorrect={manualCorrect} onBuzzerCorrect={handleBuzzerHost} onBuzzerWrongContinue={handleBuzzerWrongContinue} db={db}/>}

        {role === 'player' && activeRoom && <PlayerDashboard room={activeRoom} player={myProfile} players={players} onAnswer={async v => {
            await updateDoc(doc(db,'players',user.uid),{
                currentAnswer:v,
                [`answers.${activeRoom.currentQuestionIndex}`]:v,
                stepLockedIn: activeRoom.currentStepIndex || 0
            });
        }} onUseJoker={async () => {
            if(window.confirm("Bist du sicher? Der Joker kann nur EINMAL pro Quiz eingesetzt werden!")) {
                await updateDoc(doc(db, 'players', user.uid), { jokerUsed: true, jokerQuestion: activeRoom.currentQuestionIndex });
            }
        }} onBuzz={async (reactionTime) => {
            if(!activeRoom.buzzerWinner && !(activeRoom.buzzerLockedOut || []).includes(user.uid)) {
              await updateDoc(doc(db,'rooms',currentRoomCode),{buzzerWinner: user.uid, buzzerWinnerName: myProfile.name, buzzerReaction: reactionTime});
            }
        }}/>}

        {role === 'observer' && activeRoom && <ObserverDashboard room={activeRoom} players={players} />}

        {(role === 'player' || role === 'beamer' || role === 'observer') && roomMissing && (
          <div className="text-center py-16 bg-white rounded-3xl border border-sky-100 shadow-xl max-w-md mx-auto text-slate-700">
            <div className="text-6xl mb-6">👋</div>
            <h2 className="text-2xl font-bold mb-2">Das Quiz wurde beendet</h2>
            <p className="text-slate-500 mb-8">Danke fürs Mitspielen!</p>
            <button onClick={leaveRoom} className="bg-[#E69F00] text-white px-8 py-3 rounded-xl font-bold shadow-md">Zur Startseite</button>
          </div>
        )}
      </main>
    </div>
  );
}
