import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { ChevronLeft, Edit3, Folder, FolderOpen, Play, Plus, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { getQuestionTotal } from '../lib/helpers';
import { Modal } from '../components/ui';
import { deleteImages, scanImages } from '../lib/images';

export function LoginView({ onJoin, onAdmin, onJoinBeamer, onJoinObserver }) {
  // Raum-Code aus dem Link übernehmen (z.B. vom QR-Code: ...?raum=AB12)
  const [c, setC] = useState(() => {
    try { return (new URLSearchParams(window.location.search).get('raum') || '').toUpperCase().slice(0, 4); } catch (e) { return ''; }
  });
  const [n, setN] = useState('');
  const [t, setT] = useState(''); 
  const [existingTeams, setExistingTeams] = useState([]);

  // Beamer-Fenster aus der Moderatoren-Ansicht: ...?raum=AB12&ansicht=beamer
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = (params.get('raum') || '').toUpperCase();
      if (params.get('ansicht') === 'beamer' && code.length === 4) {
        window.history.replaceState(null, '', window.location.pathname);
        onJoinBeamer(code);
      }
    } catch (e) {}
  }, []);

  // Teams nur für den eingegebenen Raum laden
  useEffect(() => {
    if (c.length !== 4) { setExistingTeams([]); return; }
    const unsub = onSnapshot(query(collection(db, 'players'), where('roomCode', '==', c.toUpperCase())), s => {
      setExistingTeams([...new Set(s.docs.map(d => (d.data().team || '').trim()).filter(Boolean))]);
    }, () => setExistingTeams([]));
    return () => unsub();
  }, [c]);

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
      
      <div className="flex flex-col gap-4 mt-16 text-slate-400 text-xs px-4">
          <div className="flex justify-between items-center border-b border-sky-100 pb-4">
              <button onClick={() => { if(c.length === 4) onJoinObserver(c); else alert("Bitte 4-stelligen Raum-Code oben eintragen!"); }} className="hover:text-[#E69F00] font-bold transition-colors flex items-center gap-1">👀 Nur Mitlesen (Handy)</button>
              <button onClick={() => { if(c.length === 4) onJoinBeamer(c); else alert("Bitte 4-stelligen Raum-Code oben eintragen!"); }} className="hover:text-[#E69F00] font-bold transition-colors flex items-center gap-1">📺 Als Beamer</button>
          </div>
          <button onClick={onAdmin} className="hover:text-slate-600 transition-colors mx-auto">Admin-Zentrale</button>
      </div>
    </div>
  );
}

export function AdminLogin({ onOk, onBack }) {
  const [pw, setPw] = useState('');
  return (
    <div className="max-w-sm mx-auto bg-white p-8 rounded-3xl border border-sky-100 shadow-2xl mt-10 text-center">
      <h2 className="font-bold mb-6 text-xl">Master-Login</h2>
      <input type="password" placeholder="Passwort" className="w-full bg-slate-50 p-3 rounded mb-4 border border-sky-100 outline-none" value={pw} onChange={e=>setPw(e.target.value)} onKeyPress={e=>e.key==='Enter'&&onOk(pw)} autoFocus/>
      <div className="flex gap-2"><button onClick={onBack} className="flex-1 bg-slate-100 py-2 rounded">Zurück</button><button onClick={()=>onOk(pw)} className="flex-1 bg-[#E69F00] text-white py-2 rounded font-bold shadow-md">Login</button></div>
    </div>
  );
}

export function AdminPanel({ onNew, onLib, onLogout }) {
  const [showCleanup, setShowCleanup] = useState(false);
  return (
    <div className="grid md:grid-cols-2 gap-6 pt-10">
      {showCleanup && <ImageCleanup onClose={() => setShowCleanup(false)} />}
      <button onClick={onNew} className="bg-emerald-500 text-white p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform shadow-lg"><Plus size={48}/><span className="text-xl font-bold">Neues Quiz</span></button>
      <button onClick={onLib} className="bg-[#E69F00] text-white p-10 rounded-3xl flex flex-col items-center gap-4 hover:scale-105 transition-transform shadow-lg"><FolderOpen size={48}/><span className="text-xl font-bold">Bibliothek</span></button>
      <button onClick={() => setShowCleanup(true)} className="md:col-span-2 bg-white border border-sky-100 text-slate-500 hover:text-slate-700 hover:bg-slate-50 p-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-sm">🧹 Bilder aufräumen</button>
      <button onClick={onLogout} className="md:col-span-2 text-slate-400 underline mt-6">Abmelden</button>
    </div>
  );
}

export function Library({ onSelect, onEdit, onBack, db }) {
  const [t, setT] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);

  useEffect(() => { 
    getDocs(collection(db,'quiz_templates')).then(s => setT(s.docs.map(d => ({id:d.id, ...d.data()})))); 
  }, []);

  const deleteQuiz = async (id) => { 
    if(window.confirm("Bist du sicher?")) { 
      await deleteDoc(doc(db, 'quiz_templates', id)); 
      setT(t.filter(q => q.id !== id)); 
    } 
  };
  
  const folders = [...new Set(t.map(q => q.folder).filter(f => f && f.trim() !== ''))].sort();

  const displayQuizzes = currentFolder 
    ? t.filter(q => q.folder === currentFolder) 
    : t.filter(q => !q.folder || q.folder.trim() === '');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-sky-100 shadow-sm">
        <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-700">
          {currentFolder ? (
            <>
              <button onClick={() => setCurrentFolder(null)} className="p-2 hover:bg-sky-50 text-slate-400 hover:text-sky-600 rounded-lg transition-colors" title="Zurück zur Übersicht">
                <ChevronLeft size={24}/>
              </button> 
              <Folder size={28} className="text-sky-400"/>
              {currentFolder}
            </>
          ) : (
             <>
               <FolderOpen size={28} className="text-[#E69F00]"/> Deine Bibliothek
             </>
          )}
        </h2>
        <button onClick={onBack} className="text-slate-400 hover:text-slate-600 px-4 py-2 font-bold transition-colors">Schließen</button>
      </div>

      {!currentFolder && folders.length > 0 && (
        <div className="mb-10">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">Deine Ordner</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {folders.map(f => {
              const quizCount = t.filter(q => q.folder === f).length;
              return (
                <button key={f} onClick={() => setCurrentFolder(f)} className="bg-white p-6 rounded-2xl flex flex-col items-center gap-3 border border-sky-100 hover:border-sky-300 hover:shadow-md transition-all group">
                  <Folder size={48} className="text-sky-300 group-hover:text-sky-500 transition-colors"/>
                  <div className="text-center w-full">
                      <span className="font-bold text-slate-700 truncate block w-full">{f}</span>
                      <span className="text-xs text-slate-400 font-medium">{quizCount} Quiz{quizCount !== 1 ? 'zes' : ''}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        {!currentFolder && folders.length > 0 && displayQuizzes.length > 0 && (
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 px-2 pt-4 border-t border-sky-100">Quizzes ohne Ordner</h3>
        )}
        
        {displayQuizzes.length === 0 && currentFolder && (
             <div className="text-center py-12 text-slate-400 italic">Dieser Ordner ist leer.</div>
        )}

        <div className="space-y-4">
            {displayQuizzes.map(x => (
              <div key={x.id} className="bg-white p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-sky-50 shadow-sm hover:shadow-md transition-shadow">
                <div>
                  <p className="font-bold text-xl text-slate-700">{x.title}</p>
                  <p className="text-sm text-slate-400">{getQuestionTotal(x.questions || [])} Fragen{(x.questions || []).some(q => q.type === 'slide') && ` · ${(x.questions || []).filter(q => q.type === 'slide').length} Folien`} {x.allowJokers && <span className="text-amber-500 font-bold ml-2">🌟 Joker aktiv</span>}</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button onClick={() => onEdit(x)} className="p-3 text-slate-400 hover:text-[#E69F00] bg-slate-50 rounded-lg transition-colors" title="Quiz bearbeiten"><Edit3 size={20}/></button>
                  <button onClick={() => deleteQuiz(x.id)} className="p-3 text-slate-400 hover:text-red-500 bg-slate-50 rounded-lg transition-colors" title="Quiz löschen"><Trash2 size={20}/></button>
                  <button onClick={() => onSelect(x)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold ml-auto sm:ml-2 shadow-md transition-colors w-full sm:w-auto flex items-center justify-center gap-2"><Play size={20}/> Spielen</button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// --- BILDER AUFRÄUMEN ---
function ImageCleanup({ onClose }) {
  const [state, setState] = useState('scanning'); // scanning | result | deleting | done | error
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState('');
  const mb = (b) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

  const run = async (deep) => {
    setState('scanning');
    try { setRes(await scanImages(deep)); setState('result'); }
    catch (e) { console.error(e); setMsg(e.message || String(e)); setState('error'); }
  };
  useEffect(() => { run(false); }, []);

  const del = async () => {
    if (!res || res.unused.length === 0) return;
    if (!window.confirm(`${res.unused.length} ungenutzte Bilder endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
    setState('deleting');
    try { await deleteImages(res.unused.map(([id]) => id)); setMsg(`${res.unused.length} Bilder gelöscht (${mb(res.unusedBytes)} frei).`); setState('done'); }
    catch (e) { console.error(e); setMsg(e.message || String(e)); setState('error'); }
  };

  return (
    <Modal title="🧹 Bilder aufräumen" onClose={onClose}>
      {state === 'scanning' && <p className="text-slate-500 animate-pulse py-8 text-center">Prüfe, welche Bilder noch benutzt werden …</p>}
      {state === 'deleting' && <p className="text-slate-500 animate-pulse py-8 text-center">Lösche ungenutzte Bilder …</p>}
      {state === 'error' && <p className="text-red-500 py-4">Das hat nicht geklappt: {msg}</p>}
      {state === 'done' && (
        <div className="text-center py-6 space-y-4">
          <div className="text-5xl">✨</div>
          <p className="font-bold text-slate-700">{msg}</p>
          <button onClick={() => run(false)} className="text-sm text-sky-600 font-bold">Nochmal prüfen</button>
        </div>
      )}
      {state === 'result' && res && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 rounded-2xl p-4"><div className="text-3xl font-black text-slate-700">{res.total}</div><div className="text-xs text-slate-400 font-bold">erfasst</div></div>
            <div className="bg-emerald-50 rounded-2xl p-4"><div className="text-3xl font-black text-emerald-600">{res.used}</div><div className="text-xs text-emerald-600 font-bold">in Benutzung</div></div>
            <div className="bg-amber-50 rounded-2xl p-4"><div className="text-3xl font-black text-amber-600">{res.unused.length}</div><div className="text-xs text-amber-600 font-bold">ungenutzt · {mb(res.unusedBytes)}</div></div>
          </div>
          {res.recentUnused > 0 && <p className="text-xs text-slate-400">{res.recentUnused} ungenutzte Bilder sind jünger als 24 Stunden und bleiben zur Sicherheit erhalten.</p>}
          {res.deep && <p className="text-xs text-emerald-600">Tiefenscan erledigt – {res.added} ältere Bilder wurden neu erfasst.</p>}
          <button onClick={del} disabled={res.unused.length === 0} className="w-full bg-red-500 hover:bg-red-600 disabled:bg-slate-200 disabled:text-slate-400 text-white py-4 rounded-2xl font-bold">
            {res.unused.length === 0 ? 'Nichts zu löschen 🎉' : `${res.unused.length} ungenutzte Bilder löschen`}
          </button>
          {!res.deep && (
            <div className="border-t border-sky-50 pt-4">
              <p className="text-xs text-slate-500 mb-2">Bilder, die vor diesem Update eingefügt wurden, kennt die Übersicht noch nicht. Ein einmaliger Tiefenscan erfasst sie – dafür werden alle Bilder einmal geladen, das kann bei vielen Folien etwas dauern.</p>
              <button onClick={() => run(true)} className="text-sm bg-slate-50 hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold border border-slate-200">🔎 Tiefenscan starten</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
