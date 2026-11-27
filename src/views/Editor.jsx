import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, ChevronLeft, Clock, Copy, Download, FolderOpen, ImageIcon, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import { GeoMap, MAP_STYLES, MAP_VIEWS, MapErrorBoundary } from '../components/GeoMap';
import { FieldLabel, ImageInput, Modal, QuizImage, Toggle, TypePicker, ZoomFocusPicker } from '../components/ui';
import { db } from '../firebase';
import { ZOOM_DEFAULT_SECONDS, getMediaType, getQuestionNumber, getQuestionTotal, getRoundNumber, getSlideTemplate, isInfoItem, isSlideLike } from '../lib/helpers';
import { uploadQuizImage } from '../lib/images';
import { DEFAULT_GEO, QUESTION_TYPES, applyTypeDefaults, createItem, getItemTitle, getTypeInfo, getWarnings, makeKey, withKey } from '../lib/questionTypes';
import { EditorPreview } from './EditorPreview';
import { SLIDE_LAYOUTS, SLIDE_THEMES, getSlideLayout } from '../components/Slides';

export function HostSetup({ onCreate, onBack, db, initialQuiz }) {
  const [title, setTitle] = useState(initialQuiz ? initialQuiz.title : '');
  const [folder, setFolder] = useState(initialQuiz ? initialQuiz.folder || '' : '');
  const [allowJokers, setAllowJokers] = useState(initialQuiz ? initialQuiz.allowJokers !== false : true);
  const [qs, setQs] = useState(() => (initialQuiz && initialQuiz.questions && initialQuiz.questions.length ? initialQuiz.questions : [createItem('multiple')]).map(withKey));
  const [selectedKey, setSelectedKey] = useState(null);
  const [picker, setPicker] = useState(null);        // { mode: 'add' | 'change' }
  const [showSettings, setShowSettings] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showPreview, setShowPreview] = useState(() => { try { return localStorage.getItem('quizkopp-preview') !== 'off'; } catch (e) { return true; } });
  const togglePreview = (on) => { setShowPreview(on); try { localStorage.setItem('quizkopp-preview', on ? 'on' : 'off'); } catch (e) {} };
  const [toast, setToast] = useState(null);           // { msg, undo }
  const [saveState, setSaveState] = useState(initialQuiz?.id ? 'saved' : 'idle');
  const [importing, setImporting] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [collapsed, setCollapsed] = useState({}); // zugeklappte Runden (nach _key)

  const quizIdRef = useRef(initialQuiz?.id || null);
  const firstRender = useRef(true);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);
  const fileInputRef = useRef(null);
  const slideImportRef = useRef(null);
  const slideImportTarget = useRef(null);

  const selectedIndex = Math.max(0, qs.findIndex(q => q._key === selectedKey));
  const selected = qs[selectedIndex] || null;

  useEffect(() => { if (!selectedKey && qs[0]) setSelectedKey(qs[0]._key); }, [selectedKey, qs]);
  useEffect(() => { setShowMore(false); }, [selectedKey]);

  // --- Hinweise unten einblenden (ersetzt die Browser-Popups) ---
  const showToast = (msg, undo = null) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 3500);
  };

  // --- Automatisch speichern ---
  const saveNow = async (data) => {
    const payload = data || { title, folder, allowJokers, qs };
    if (!payload.title.trim()) { setSaveState('needsTitle'); return false; }
    const record = { title: payload.title.trim(), folder: payload.folder.trim(), questions: payload.qs, allowJokers: payload.allowJokers };
    if (JSON.stringify(record).length > 950000) { setSaveState('tooBig'); return false; }
    setSaveState('saving');
    try {
      if (quizIdRef.current) {
        await updateDoc(doc(db, 'quiz_templates', quizIdRef.current), record);
      } else {
        const ref = doc(collection(db, 'quiz_templates'));
        quizIdRef.current = ref.id;
        await setDoc(ref, { ...record, createdAt: Date.now() });
      }
      setSaveState('saved');
      return true;
    } catch (err) {
      console.error(err);
      setSaveState('error');
      return false;
    }
  };

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSaveState(title.trim() ? 'dirty' : 'needsTitle');
    clearTimeout(saveTimer.current);
    const snapshot = { title, folder, allowJokers, qs };
    saveTimer.current = setTimeout(() => saveNow(snapshot), 1200);
    return () => clearTimeout(saveTimer.current);
  }, [title, folder, allowJokers, qs]);

  const flushSave = async () => {
    clearTimeout(saveTimer.current);
    if (saveState === 'dirty' || saveState === 'error') await saveNow();
  };

  // --- Bearbeiten ---
  const updateItem = (key, patch) => setQs(prev => prev.map(q => q._key === key ? { ...q, ...patch } : q));
  const updateStep = (key, sIdx, patch) => setQs(prev => prev.map(q => q._key === key ? { ...q, steps: q.steps.map((s, i) => i === sIdx ? { ...s, ...patch } : s) } : q));

  const insertAfterSelected = (items) => {
    setQs(prev => {
      const idx = prev.findIndex(q => q._key === selectedKey);
      const n = [...prev];
      n.splice(idx === -1 ? n.length : idx + 1, 0, ...items);
      return n;
    });
    setSelectedKey(items[0]._key);
  };

  const addItem = (type) => {
    setPicker(null);
    if (type !== 'round') { insertAfterSelected([createItem(type)]); return; }
    // Neue Runde: davor automatisch einen Zwischenstand einfügen, falls die vorige Runde keinen hat
    const idx = qs.findIndex(q => q._key === selectedKey);
    const insertAt = idx === -1 ? qs.length : idx + 1;
    const before = qs.slice(0, insertAt);
    const roundsBefore = before.filter(q => q.type === 'round').length;
    const lastItem = before[before.length - 1];
    const hasContentBefore = before.some(q => !isInfoItem(q));
    const round = createItem('round');
    round.q = `Runde ${roundsBefore + 1}`;
    const items = [];
    if (hasContentBefore && lastItem && lastItem.type !== 'break') {
      const brk = createItem('break');
      brk.q = roundsBefore > 0 ? `Zwischenstand nach Runde ${roundsBefore}` : 'Zwischenstand';
      items.push(brk);
    }
    items.push(round);
    setQs(prev => { const n = [...prev]; n.splice(insertAt, 0, ...items); return n; });
    setSelectedKey(round._key);
    if (items.length > 1) showToast('Neue Runde angelegt – mit Zwischenstand davor');
  };
  const changeType = (type) => { if (selected) updateItem(selected._key, applyTypeDefaults(selected, type)); setPicker(null); };

  const duplicateItem = (key) => {
    const src = qs.find(q => q._key === key);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), _key: makeKey() };
    setQs(prev => { const i = prev.findIndex(q => q._key === key); const n = [...prev]; n.splice(i + 1, 0, copy); return n; });
    setSelectedKey(copy._key);
    showToast('Kopie eingefügt');
  };

  const deleteItem = (key) => {
    const idx = qs.findIndex(q => q._key === key);
    if (idx === -1) return;
    const removed = qs[idx];
    const next = qs.filter(q => q._key !== key);
    setQs(next);
    if (selectedKey === key) setSelectedKey(next[Math.min(idx, next.length - 1)]?._key || null);
    showToast(`„${getItemTitle(removed).slice(0, 40)}“ gelöscht`, () => {
      setQs(prev => { const n = [...prev]; n.splice(Math.min(idx, n.length), 0, removed); return n; });
      setSelectedKey(removed._key);
      setToast(null);
    });
  };

  const moveItem = (key, dir) => setQs(prev => {
    const i = prev.findIndex(q => q._key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const n = [...prev];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  // --- Drag & Drop in der Ablaufliste ---
  const onDragOverItem = (e, index) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };
  const onDropList = (e) => {
    e.preventDefault();
    if (!dragKey || dropIndex === null) { setDragKey(null); setDropIndex(null); return; }
    setQs(prev => {
      const from = prev.findIndex(q => q._key === dragKey);
      if (from === -1) return prev;
      const n = [...prev];
      const [item] = n.splice(from, 1);
      n.splice(dropIndex > from ? dropIndex - 1 : dropIndex, 0, item);
      return n;
    });
    setDragKey(null); setDropIndex(null);
  };

  // --- Globale Aktionen (mit Rückgängig statt Rückfrage) ---
  const applyGlobal = (field, value, label) => {
    const before = qs;
    setQs(qs.map(q => isInfoItem(q) ? q : { ...q, [field]: value }));
    showToast(`${label} – für alle Fragen übernommen`, () => { setQs(before); setToast(null); });
  };

  // --- Folien-Import ---
  const openSlideImport = (atEnd = false) => { slideImportTarget.current = atEnd ? 'end' : 'selected'; slideImportRef.current?.click(); };
  const handleSlideImport = async (e) => {
    const files = Array.from(e.target.files || [])
      .filter(f => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    e.target.value = '';
    if (files.length === 0) return;
    const target = slideImportTarget.current;
    const newSlides = [];
    let failed = 0;
    setImporting({ done: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      try {
        const ref = await uploadQuizImage(files[i]);
        newSlides.push({ ...getSlideTemplate(), imgUrl: ref, q: files[i].name.replace(/\.[^.]+$/, ''), _key: makeKey() });
      } catch (err) { console.error(err); failed++; }
      setImporting({ done: i + 1, total: files.length });
    }
    setImporting(null);
    if (newSlides.length === 0) { showToast('Keine Folie konnte gespeichert werden.'); return; }
    const isEmptyStart = qs.length === 1 && !qs[0].q && !qs[0].imgUrl && qs[0].type === 'multiple';
    if (isEmptyStart) { setQs(newSlides); setSelectedKey(newSlides[0]._key); }
    else if (target === 'end') { setQs(prev => [...prev, ...newSlides]); setSelectedKey(newSlides[0]._key); }
    else insertAfterSelected(newSlides);
    setShowSettings(false);
    showToast(`${newSlides.length} Folie(n) eingefügt${failed ? ` – ${failed} fehlgeschlagen` : ''}`);
  };

  // --- CSV ---
  const downloadCsvTemplate = () => {
    const headers = "Typ;Frage;Option 1;Option 2;Option 3;Option 4;Lösung;Timer;Bild/Video/Audio URL;Notiz\n";
    const rows = [
      "multiple;Wie hoch ist der Eiffelturm?;300m;330m;350m;400m;2;30;;Der Eiffelturm wurde 1889 zur Weltausstellung erbaut.",
      "text;Wer schrieb Faust?;-;-;-;-;Goethe;30;;",
      "estimation;Wie alt wurde die älteste Schildkröte?;-;-;-;-;188;30;;",
      "buzzer;Erkenne dieses Lied (Audio läuft über Beamer);-;-;-;-;Queen - Bohemian Rhapsody;0;/song1.mp3;",
      "slide;Runde 2: Geografie;-;-;-;-;-;0;;Jetzt wird's international!",
      "break;Ende von Runde 1 - Zwischenstand!;-;-;-;-;-;0;;",
    ];
    const blob = new Blob(["﻿" + headers + rows.join("\n") + "\n"], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Quizkopp_Vorlage.csv"; a.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const lines = event.target.result.split(/\r\n|\n|\r/);
      const newQuestions = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(';');
        if (cols.length < 2) continue;
        const type = cols[0].toLowerCase().trim();
        if (!QUESTION_TYPES.some(t => t.type === type)) continue;
        const parsedQ = createItem(type);
        parsedQ.q = cols[1] || "";
        if (type === 'multiple') parsedQ.options = [cols[2] || "", cols[3] || "", cols[4] || "", cols[5] || ""];
        parsedQ.correctIndex = (parseInt(cols[6]) - 1) || 0;
        parsedQ.correctValue = cols[6] && cols[6] !== '-' ? cols[6] : "";
        parsedQ.timer = parseInt(cols[7]) || 0;
        parsedQ.imgUrl = cols[8] || "";
        parsedQ.note = cols[9] || "";
        newQuestions.push(parsedQ);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (newQuestions.length === 0) { showToast('Keine gültigen Fragen gefunden – bitte Format prüfen.'); return; }
      const before = qs;
      const isEmptyStart = qs.length === 1 && !qs[0].q && !qs[0].imgUrl && qs[0].type === 'multiple';
      setQs(isEmptyStart ? newQuestions : [...qs, ...newQuestions]);
      setSelectedKey(newQuestions[0]._key);
      setShowSettings(false);
      showToast(`${newQuestions.length} Fragen importiert`, () => { setQs(before); setToast(null); });
    };
    reader.readAsText(file, "UTF-8");
  };

  // --- Start & Zurück ---
  const allWarnings = qs.map(q => ({ q, w: getWarnings(q) })).filter(x => x.w.length > 0);
  const startQuiz = async () => {
    if (qs.length === 0) return showToast('Füge zuerst mindestens ein Element hinzu.');
    if (allWarnings.length > 0 && !window.confirm(`${allWarnings.length} Element(e) haben noch offene Hinweise (⚠️ in der Liste). Trotzdem starten?`)) return;
    await flushSave();
    onCreate(qs, allowJokers);
  };
  const goBack = async () => {
    if (!title.trim() && qs.some(q => (q.q || '').trim() || q.imgUrl) && !window.confirm('Dein Quiz hat noch keinen Titel und wurde deshalb nicht gespeichert. Trotzdem verlassen?')) return;
    await flushSave();
    onBack();
  };

  const questionCount = getQuestionTotal(qs);
  const slideCount = qs.filter(q => q.type === 'slide').length;

  const saveLabel = {
    idle: { text: 'Gib einen Titel ein – dann wird automatisch gespeichert', cls: 'text-slate-400' },
    needsTitle: { text: '✏️ Titel fehlt – noch nicht gespeichert', cls: 'text-amber-600' },
    dirty: { text: '● Änderungen …', cls: 'text-slate-400' },
    saving: { text: '⏳ Speichert …', cls: 'text-[#2B4470]' },
    saved: { text: '✓ Gespeichert', cls: 'text-emerald-600' },
    error: { text: '⚠️ Speichern fehlgeschlagen – versuche es erneut', cls: 'text-red-500' },
    tooBig: { text: '⚠️ Quiz zu groß zum Speichern', cls: 'text-red-500' },
  }[saveState];

  // --- Detail-Bereich für das ausgewählte Element ---
  const renderDetail = (q) => {
    const info = getTypeInfo(q.type);
    const warnings = getWarnings(q);
    const isQuestion = !isInfoItem(q);
    const supportsShowAnswers = ['multiple', 'estimation'].includes(q.type);
    const moreBadges = [
      q.timer > 0 && q.type !== 'buzzer' && `⏱ ${q.timer}s`,
      allowJokers && q.isJoker && '🌟 Joker',
      q.imgUrl && q.showImg && '📱 Medien aufs Handy',
      supportsShowAnswers && q.showAnswers === false && '🙈 Antworten verborgen',
    ].filter(Boolean);

    return (
      <div className="bg-[#FFFBF3] rounded-3xl border border-[#E6D6B8] shadow-md">
        {/* Kopfzeile */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-[#EFE3CC]">
          <button onClick={() => setPicker({ mode: 'change' })} className="flex items-center gap-2 bg-slate-50 hover:bg-amber-50 border border-[#E6D6B8] hover:border-[#D4A12A] px-4 py-2 rounded-xl transition-colors" title="Typ ändern">
            <span className="text-xl">{info.icon}</span>
            <span className="font-bold text-[#14284B]">{info.label}</span>
            <span className="text-xs text-slate-400 ml-1">ändern</span>
          </button>
          <span className="text-sm text-slate-400 font-medium">{selectedIndex + 1} von {qs.length}{isQuestion && ` · Frage ${getQuestionNumber(qs, selectedIndex)}`}</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => moveItem(q._key, -1)} disabled={selectedIndex === 0} className="p-2 rounded-lg text-slate-400 hover:bg-[#F8EFDF] disabled:opacity-30" title="Nach oben"><ArrowUp size={18}/></button>
            <button onClick={() => moveItem(q._key, 1)} disabled={selectedIndex === qs.length - 1} className="p-2 rounded-lg text-slate-400 hover:bg-[#F8EFDF] disabled:opacity-30" title="Nach unten"><ArrowDown size={18}/></button>
            <button onClick={() => duplicateItem(q._key)} className="p-2 rounded-lg text-slate-400 hover:bg-[#F8EFDF] hover:text-[#14284B]" title="Duplizieren"><Copy size={18}/></button>
            <button onClick={() => deleteItem(q._key)} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Löschen"><Trash2 size={18}/></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
              {warnings.map(w => <div key={w}>⚠️ {w}</div>)}
            </div>
          )}

          {/* Titel / Frage */}
          <div>
            <FieldLabel>{q.type === 'round' ? `Name der Runde ${getRoundNumber(qs, selectedIndex)}` : q.type === 'slide' ? ({ quote: 'Fun Fact / Zitat', pause: 'Überschrift (z.B. Kurze Pause)', image: 'Titel (nur für dich in der Regie)', rules: 'Überschrift (z.B. Die Regeln)' }[getSlideLayout(q)] || 'Überschrift') : q.type === 'break' ? 'Überschrift' : q.type === 'step' ? 'Kategorie / Hauptfrage' : 'Frage'}</FieldLabel>
            <textarea rows={isInfoItem(q) ? 1 : 2}
              placeholder={q.type === 'round' ? 'z.B. Geografie' : q.type === 'break' ? 'z.B. Zwischenstand nach Runde 1' : q.type === 'slide' ? "z.B. 'Regeln Runde 2' – erscheint in der Regie-Vorschau" : q.type === 'step' ? "z.B. 'Wer bin ich?'" : q.type === 'buzzer' ? 'Frage (oder leer lassen für eine reine Buzzer-Runde)' : 'Wie lautet deine Frage?'}
              className="w-full bg-slate-50 p-4 rounded-2xl border border-[#E6D6B8] outline-none focus:border-[#D4A12A] focus:bg-[#FFFBF3] text-xl font-bold text-[#14284B] resize-none"
              value={q.q} onChange={e => updateItem(q._key, { q: e.target.value })} />
          </div>

          {q.type === 'round' && (
            <p className="text-sm text-slate-500 bg-indigo-50 rounded-xl p-4">🎬 Erscheint als große Startfolie: <b>RUNDE {getRoundNumber(qs, selectedIndex)}</b> + Name. Optional mit Untertitel und Regeln als Anker-Punkte.</p>
          )}

          {/* Folie: Vorlage wählen & ausfüllen */}
          {q.type === 'slide' && (
            <div>
              <FieldLabel>Vorlage</FieldLabel>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {SLIDE_LAYOUTS.map(l => {
                  const active = getSlideLayout(q) === l.key;
                  return (
                    <button key={l.key} onClick={() => updateItem(q._key, { slideLayout: l.key, showCaptain: ['title', 'pause'].includes(l.key) })}
                      className={`text-left p-3 rounded-2xl border-2 transition-all ${active ? 'border-[#D4A12A] bg-amber-50' : 'border-[#E6D6B8] bg-[#FFFBF3] hover:border-[#C9A96A]'}`}>
                      <div className="text-xl">{l.icon}</div>
                      <div className="font-bold text-[#14284B] text-sm">{l.label}</div>
                      <div className="text-[11px] text-slate-400 leading-snug">{l.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isSlideLike(q) && (() => {
            const lay = getSlideLayout(q);
            const bullets = q.slideBullets && q.slideBullets.length ? q.slideBullets : ['', '', ''];
            return (
              <div className="space-y-4">
                {(lay === 'image' || lay === 'imageText') && (
                  <div>
                    <FieldLabel>{lay === 'image' ? 'Bild der Folie' : 'Bild links'}</FieldLabel>
                    <ImageInput variant="large" value={q.imgUrl} onChange={v => updateItem(q._key, { imgUrl: v })} />
                  </div>
                )}

                {lay !== 'image' && (
                  <div>
                    <FieldLabel>{{ title: 'Untertitel', round: 'Untertitel (optional)', imageText: 'Text', quote: 'Quelle / Zusatz (optional)', pause: 'Text unter dem Countdown (optional)', rules: '' }[lay] || 'Text'}</FieldLabel>
                    {lay !== 'rules' && (
                      <textarea className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] resize-none h-20 outline-none focus:border-[#D4A12A]"
                        placeholder={{ title: 'z.B. Heute: 6 Runden, 1 Kapitän und jede Menge Spaß', round: 'z.B. Alles rund um Hamburg', imageText: 'Was soll neben dem Bild stehen?', quote: 'z.B. Quelle oder „Fun Fact“', pause: 'z.B. Getränke holen – um 21:15 geht\'s weiter!' }[lay] || ''}
                        value={q.note || ''} onChange={e => updateItem(q._key, { note: e.target.value })} />
                    )}
                  </div>
                )}

                {(lay === 'rules' || lay === 'round') && (
                  <div className="space-y-2">
                    <FieldLabel>{lay === 'rules' ? '⚓ Punkte (bis zu 10)' : '⚓ Regeln der Runde (optional, bis zu 10)'}</FieldLabel>
                    {bullets.map((b, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[#D4A12A]">⚓</span>
                        <input className="flex-1 bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] outline-none focus:border-[#D4A12A]" placeholder={`Punkt ${i + 1}`} value={b}
                          onChange={e => updateItem(q._key, { slideBullets: bullets.map((x, xi) => xi === i ? e.target.value : x) })} />
                        <button onClick={() => { const n = [...bullets]; if (i > 0) { [n[i - 1], n[i]] = [n[i], n[i - 1]]; updateItem(q._key, { slideBullets: n }); } }} disabled={i === 0} className="p-2 text-slate-400 hover:text-[#14284B] disabled:opacity-25"><ArrowUp size={16}/></button>
                        <button onClick={() => { const n = [...bullets]; if (i < n.length - 1) { [n[i + 1], n[i]] = [n[i], n[i + 1]]; updateItem(q._key, { slideBullets: n }); } }} disabled={i === bullets.length - 1} className="p-2 text-slate-400 hover:text-[#14284B] disabled:opacity-25"><ArrowDown size={16}/></button>
                        <button onClick={() => updateItem(q._key, { slideBullets: bullets.filter((_, xi) => xi !== i) })} disabled={bullets.length <= 1} className="p-2 text-slate-300 hover:text-red-500 disabled:opacity-25"><Trash2 size={16}/></button>
                      </div>
                    ))}
                    {bullets.length < 10 && (
                      <button onClick={() => updateItem(q._key, { slideBullets: [...bullets, ''] })} className="text-sm text-[#14284B] font-bold hover:text-[#0E1D38] flex items-center gap-1"><Plus size={16}/> Punkt hinzufügen</button>
                    )}
                    {lay === 'rules' && <Toggle checked={q.revealBullets} onChange={v => updateItem(q._key, { revealBullets: v })} label="👆 Punkte einzeln per Klick aufdecken" hint="Wie in PowerPoint: jeder Klick zeigt den nächsten Punkt" />}
                  </div>
                )}

                {lay === 'pause' && (
                  <div className="flex items-center gap-3">
                    <FieldLabel>⏱ Countdown</FieldLabel>
                    <input type="number" min="0" max="120" className="w-24 bg-slate-50 p-2 rounded-lg border border-[#E6D6B8] text-center" value={q.pauseMinutes ?? 10} onChange={e => updateItem(q._key, { pauseMinutes: Math.max(0, parseInt(e.target.value) || 0) })} />
                    <span className="text-xs text-slate-400">Minuten (0 = ohne Countdown)</span>
                  </div>
                )}

                {lay !== 'image' && (
                  <div className="grid sm:grid-cols-2 gap-4 bg-slate-50 rounded-2xl p-4">
                    <div>
                      <FieldLabel>Hintergrund</FieldLabel>
                      <div className="flex gap-2">
                        {Object.entries(SLIDE_THEMES).map(([k, th]) => (
                          <button key={k} onClick={() => updateItem(q._key, { slideBg: k })} className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-bold ${(q.slideBg || 'navy') === k ? 'border-[#D4A12A]' : 'border-transparent'}`} style={{ background: '#fff' }}>
                            <span className="w-5 h-5 rounded-full border border-slate-200" style={{ background: th.bg }}></span>{th.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Toggle checked={q.showCaptain !== false} onChange={v => updateItem(q._key, { showCaptain: v })} label="🧑‍✈️ Kapitän zeigen" />
                      {q.showCaptain !== false && (
                        <input className="w-full bg-[#FFFBF3] p-2 rounded-lg border border-[#E6D6B8] text-sm outline-none focus:border-[#D4A12A]" placeholder="Sprechblase (optional), z.B. Moin!" value={q.captainText || ''} onChange={e => updateItem(q._key, { captainText: e.target.value })} />
                      )}
                    </div>
                  </div>
                )}

                <Toggle checked={q.showImg} onChange={v => updateItem(q._key, { showImg: v })} label="📱 Folie auch auf den Handys zeigen" hint="Sonst steht dort „Schau nach vorne!“" />
              </div>
            );
          })()}

          {q.type === 'break' && (
            <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">Auf dem Beamer erscheint das aktuelle Team-Ranking, auf den Handys der eigene Platz.</p>
          )}

          {/* Medien */}
          {isQuestion && (
            <div>
              <FieldLabel>{q.type === 'zoom' ? 'Bild für den Zoom' : 'Bild, Video oder Audio (optional)'}</FieldLabel>
              <ImageInput value={q.imgUrl} onChange={v => updateItem(q._key, { imgUrl: v })} />
              {q.imgUrl && getMediaType(q.imgUrl) === 'image' && (
                <QuizImage src={q.imgUrl} className="mt-3 max-h-40 rounded-xl border border-[#E6D6B8] bg-slate-50 object-contain" placeholderClassName="mt-3 h-24 w-40 rounded-xl bg-slate-50 animate-pulse" />
              )}
            </div>
          )}

          {/* Multiple Choice */}
          {q.type === 'multiple' && (
            <div>
              <FieldLabel>Antworten – klicke auf den Buchstaben der richtigen</FieldLabel>
              <div className="grid sm:grid-cols-2 gap-3">
                {(q.options || []).map((o, oi) => {
                  const isRight = Number(q.correctIndex) === oi;
                  return (
                    <div key={oi} className={`flex items-center gap-3 p-2 rounded-2xl border-2 transition-colors ${isRight ? 'border-emerald-400 bg-emerald-50' : 'border-[#E6D6B8] bg-slate-50'}`}>
                      <button onClick={() => updateItem(q._key, { correctIndex: oi })} className={`w-10 h-10 rounded-xl font-black flex-shrink-0 transition-colors ${isRight ? 'bg-emerald-500 text-white' : 'bg-[#FFFBF3] text-slate-400 border border-[#E6D6B8] hover:border-emerald-400'}`} title="Als richtige Antwort markieren">
                        {isRight ? '✓' : 'ABCD'[oi]}
                      </button>
                      <input className="bg-transparent w-full text-[#14284B] outline-none font-medium" placeholder={`Antwort ${'ABCD'[oi]}`} value={o}
                        onChange={e => updateItem(q._key, { options: q.options.map((x, xi) => xi === oi ? e.target.value : x) })} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lösung */}
          {/* Reihenfolge */}
          {q.type === 'order' && (
            <div className="space-y-3">
              <div>
                <FieldLabel>Sortier-Hinweis für die Spieler (optional)</FieldLabel>
                <input className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] outline-none focus:border-[#D4A12A]" placeholder="z.B. Vom ältesten (oben) zum jüngsten (unten)" value={q.orderHint || ''} onChange={e => updateItem(q._key, { orderHint: e.target.value })} />
              </div>
              <FieldLabel>Einträge in der RICHTIGEN Reihenfolge – die App mischt sie automatisch</FieldLabel>
              {(q.orderItems || []).map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-black flex items-center justify-center">{i + 1}</span>
                  <input className="flex-1 bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] outline-none focus:border-[#D4A12A]" placeholder={`Eintrag ${i + 1}`} value={item}
                    onChange={e => updateItem(q._key, { orderItems: q.orderItems.map((x, xi) => xi === i ? e.target.value : x) })} />
                  <button onClick={() => { const n = [...q.orderItems]; if (i > 0) { [n[i - 1], n[i]] = [n[i], n[i - 1]]; updateItem(q._key, { orderItems: n }); } }} disabled={i === 0} className="p-2 text-slate-400 hover:text-[#14284B] disabled:opacity-25"><ArrowUp size={16}/></button>
                  <button onClick={() => { const n = [...q.orderItems]; if (i < n.length - 1) { [n[i + 1], n[i]] = [n[i], n[i + 1]]; updateItem(q._key, { orderItems: n }); } }} disabled={i === q.orderItems.length - 1} className="p-2 text-slate-400 hover:text-[#14284B] disabled:opacity-25"><ArrowDown size={16}/></button>
                  <button onClick={() => updateItem(q._key, { orderItems: q.orderItems.filter((_, xi) => xi !== i) })} disabled={q.orderItems.length <= 3} className="p-2 text-slate-300 hover:text-red-500 disabled:opacity-25"><Trash2 size={16}/></button>
                </div>
              ))}
              {(q.orderItems || []).length < 8 && (
                <button onClick={() => updateItem(q._key, { orderItems: [...(q.orderItems || []), ''] })} className="text-sm text-[#14284B] font-bold hover:text-[#0E1D38] flex items-center gap-1"><Plus size={16}/> Eintrag hinzufügen</button>
              )}
              <div>
                <FieldLabel>Wertung</FieldLabel>
                <select className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] font-medium" value={q.orderScoring || 'all'} onChange={e => updateItem(q._key, { orderScoring: e.target.value })}>
                  <option value="all">1 Punkt – nur für die komplett richtige Reihenfolge</option>
                  <option value="each">1 Punkt pro richtig platziertem Eintrag</option>
                </select>
              </div>
            </div>
          )}

          {/* Bild-Zoom */}
          {q.type === 'zoom' && (
            <div className="space-y-4">
              {!q.imgUrl && <p className="text-sm text-slate-500 bg-[#F8EFDF] rounded-xl p-4">🔍 Füge oben ein Bild ein (Strg+V, hineinziehen oder hochladen). Danach wählst du hier, wohin gezoomt wird.</p>}
              <ZoomFocusPicker q={q} onChange={patch => updateItem(q._key, patch)} />
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Start-Zoom</FieldLabel>
                  <select className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] font-medium" value={q.zoomStart || 6} onChange={e => updateItem(q._key, { zoomStart: Number(e.target.value) })}>
                    <option value={3}>3× – leicht</option>
                    <option value={6}>6× – mittel</option>
                    <option value={10}>10× – schwer</option>
                    <option value={16}>16× – sehr schwer</option>
                  </select>
                </div>
                <div className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 self-end">
                  ⏱ Der Zoom läuft im Takt des Timers ({q.timer > 0 ? `${q.timer}s` : `${ZOOM_DEFAULT_SECONDS}s ohne Timer`}) – einstellbar unter „Mehr Optionen“. Das ganze Bild erscheint bei der Auflösung. Antworten wie bei Freitext, du bewertest.
                </div>
              </div>
            </div>
          )}

          {['text', 'estimation', 'buzzer', 'step', 'zoom'].includes(q.type) && (
            <div>
              <FieldLabel>{q.type === 'estimation' ? 'Richtige Zahl' : 'Lösung (nur für dich)'}</FieldLabel>
              <input type={q.type === 'estimation' ? 'number' : 'text'} className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] outline-none focus:border-[#D4A12A]"
                value={q.correctValue} onChange={e => updateItem(q._key, { correctValue: e.target.value })}
                placeholder={q.type === 'estimation' ? 'Leer lassen, wenn du das Ergebnis erst live einträgst (z.B. nach dem Wiegen)' : 'z.B. Goethe'} />
            </div>
          )}

          {/* Stufen-Rätsel */}
          {q.type === 'step' && (
            <div>
              <FieldLabel>Hinweise & Punkte</FieldLabel>
              <div className="space-y-2">
                {(q.steps || []).map((step, sIdx) => (
                  <div key={sIdx} className="flex gap-2 items-center">
                    <span className="font-black text-[#B9A274] w-6 text-right">{sIdx + 1}.</span>
                    <input placeholder={`Hinweis ${sIdx + 1} …`} className="flex-1 p-3 rounded-xl bg-slate-50 border border-[#E6D6B8] outline-none focus:border-[#D4A12A]" value={step.text} onChange={e => updateStep(q._key, sIdx, { text: e.target.value })} />
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-100 rounded-xl px-2">
                      <input type="number" className="w-12 py-3 bg-transparent text-center font-bold text-[#D4A12A] outline-none" value={step.points} onChange={e => updateStep(q._key, sIdx, { points: Number(e.target.value) })} title="Punkte für diesen Hinweis" />
                      <span className="text-xs text-amber-500 font-bold pr-1">Pkt</span>
                    </div>
                    <button onClick={() => updateItem(q._key, { steps: q.steps.filter((_, i) => i !== sIdx) })} className="text-slate-300 p-2 hover:text-red-500 rounded-xl"><Trash2 size={18}/></button>
                  </div>
                ))}
              </div>
              <button onClick={() => updateItem(q._key, { steps: [...(q.steps || []), { text: '', points: 1 }] })} className="text-sm text-[#14284B] font-bold hover:text-[#0E1D38] flex items-center gap-1 mt-3">
                <Plus size={16}/> Weiteren Hinweis hinzufügen
              </button>
            </div>
          )}

          {/* Geo */}
          {q.type === 'geo' && (
            <div className="space-y-4">
              <div>
                <FieldLabel>📍 Ziel auf der Karte anklicken</FieldLabel>
                <div className="w-full rounded-2xl overflow-hidden border border-[#DCC7A0] z-0 relative" style={{ height: '320px' }}>
                  <MapErrorBoundary>
                    <GeoMap key={`admin-${q._key}`} lat={q.targetLat ?? DEFAULT_GEO.lat} lng={q.targetLng ?? DEFAULT_GEO.lng} isTarget={true} hideLabels={false}
                      onMapClick={(p) => updateItem(q._key, { targetLat: p.lat, targetLng: p.lng })} />
                  </MapErrorBoundary>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Kartenstil</FieldLabel>
                  <select className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] font-medium" value={q.mapStyle || 'comic'} onChange={e => updateItem(q._key, { mapStyle: e.target.value })}>
                    {Object.entries(MAP_STYLES).map(([k, st]) => <option key={k} value={k}>{st.label}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Startausschnitt auf den Handys</FieldLabel>
                  <select className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] font-medium" value={q.startView || 'europe'} onChange={e => updateItem(q._key, { startView: e.target.value })}>
                    {Object.entries(MAP_VIEWS).map(([k, vw]) => <option key={k} value={k}>{vw.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <FieldLabel>👀 Vorschau: So sehen es die Spieler</FieldLabel>
                <div className="w-full max-w-md rounded-2xl overflow-hidden border border-[#DCC7A0] z-0 relative" style={{ height: '260px' }}>
                  <MapErrorBoundary>
                    <GeoMap key={`preview-${q._key}-${q.mapStyle || 'comic'}-${q.startView || 'europe'}`} hideLabels={true} isTarget={false} mapStyle={q.mapStyle || 'comic'} startView={q.startView || 'europe'} />
                  </MapErrorBoundary>
                </div>
              </div>
            </div>
          )}

          {/* Fun Fact */}
          {isQuestion && (
            <div>
              <FieldLabel>💡 Fun Fact zur Auflösung (optional)</FieldLabel>
              <textarea placeholder="Wird nach dem Auflösen auf dem Beamer gezeigt …" className="w-full bg-slate-50 p-3 rounded-xl border border-[#E6D6B8] text-[#14284B] text-sm resize-none h-20 outline-none focus:border-[#D4A12A]" value={q.note || ''} onChange={e => updateItem(q._key, { note: e.target.value })} />
            </div>
          )}

          {/* Mehr Optionen */}
          {isQuestion && (
            <div className="border border-[#E6D6B8] rounded-2xl">
              <button onClick={() => setShowMore(!showMore)} className="w-full flex flex-wrap items-center gap-2 px-4 py-3 text-left">
                <span className="font-bold text-slate-600">⚙️ Mehr Optionen</span>
                {moreBadges.map(b => <span key={b} className="text-xs bg-[#F8EFDF] text-[#14284B] px-2 py-1 rounded-lg font-semibold">{b}</span>)}
                <span className="ml-auto text-slate-400 text-sm">{showMore ? '▲' : '▼'}</span>
              </button>
              {showMore && (
                <div className="px-4 pb-4 space-y-2 border-t border-[#EFE3CC] pt-3">
                  {q.type !== 'buzzer' && (
                    <div className="flex items-center gap-3 py-1">
                      <Clock size={18} className="text-[#D4A12A]"/>
                      <span className="text-sm font-semibold text-[#14284B]">Timer</span>
                      <input type="number" min="0" className="w-20 bg-slate-50 p-2 rounded-lg border border-[#E6D6B8] text-center" value={q.timer} onChange={e => updateItem(q._key, { timer: parseInt(e.target.value) || 0 })} />
                      <span className="text-xs text-slate-400">Sekunden (0 = ohne Zeitlimit)</span>
                    </div>
                  )}
                  {allowJokers && <Toggle checked={q.isJoker} onChange={v => updateItem(q._key, { isJoker: v })} label="🌟 Joker bei dieser Frage erlauben" hint="Teams können hier ihre Punkte verdoppeln" />}
                  {q.imgUrl && <Toggle checked={q.showImg} onChange={v => updateItem(q._key, { showImg: v })} label="📱 Bild / Medien auch auf den Handys zeigen" />}
                  {supportsShowAnswers && <Toggle checked={q.showAnswers !== false} onChange={v => updateItem(q._key, { showAnswers: v })} label="📺 Antworten der Spieler auf dem Beamer zeigen" />}
                </div>
              )}
            </div>
          )}

          {/* Moderationsnotiz */}
          <div>
            <FieldLabel>🎤 Moderationsnotiz (nur für dich in der Moderatoren-Ansicht)</FieldLabel>
            <textarea placeholder="z.B. Überleitung, Anekdote, Hinweis an dich selbst …" className="w-full bg-slate-800/5 p-3 rounded-xl border border-slate-200 text-[#14284B] text-sm resize-none h-16 outline-none focus:border-slate-500" value={q.hostNotes || ''} onChange={e => updateItem(q._key, { hostNotes: e.target.value })} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Kopfzeile */}
      <div className="bg-[#FFFBF3] p-4 md:p-5 rounded-3xl border border-[#E6D6B8] shadow-sm flex flex-wrap items-center gap-4">
        <button onClick={goBack} className="p-2 text-slate-400 hover:text-[#14284B] hover:bg-slate-50 rounded-xl" title="Zurück"><ChevronLeft size={24}/></button>
        <div className="flex-1 min-w-[220px]">
          <input placeholder="Wie heißt dein Quiz?" className="bg-transparent text-2xl font-bold outline-none w-full text-[#14284B] placeholder:text-slate-300" value={title} onChange={e => setTitle(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs">
            <span className="flex items-center gap-1 text-slate-400">
              <FolderOpen size={14}/>
              <input placeholder="Ordner (optional)" className="bg-transparent outline-none text-slate-500 w-36" value={folder} onChange={e => setFolder(e.target.value)} />
            </span>
            <span className={`font-semibold ${saveLabel.cls}`}>{saveLabel.text}</span>
          </div>
        </div>
        <button onClick={() => setShowSettings(true)} className="px-4 py-3 rounded-xl border border-[#E6D6B8] text-slate-600 font-bold hover:bg-slate-50 flex items-center gap-2">⚙️ <span className="hidden sm:inline">Quiz-Einstellungen</span></button>
        <button onClick={startQuiz} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-md flex items-center gap-2"><Play size={18}/> Quiz starten</button>
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* Ablaufliste */}
        <div className="bg-[#FFFBF3] rounded-3xl border border-[#E6D6B8] shadow-sm lg:sticky lg:top-24">
          <div className="px-5 py-4 border-b border-[#EFE3CC] flex justify-between items-baseline">
            <h3 className="font-bold text-[#14284B]">Ablauf</h3>
            <span className="text-xs text-slate-400">{qs.filter(q => q.type === 'round').length > 0 && `${qs.filter(q => q.type === 'round').length} Runden · `}{questionCount} Fragen · {slideCount} Folien</span>
          </div>
          <div className="p-2 max-h-[60vh] overflow-y-auto" onDragOver={e => e.preventDefault()} onDrop={onDropList}>
            {qs.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Noch leer – füge unten etwas hinzu.</p>}
            {(() => {
              // Runden-Zugehörigkeit vorab berechnen
              let current = null;
              const roundOf = qs.map(q => { if (q.type === 'round') current = q._key; return current; });
              const questionsInRound = {};
              qs.forEach((q, i) => { const r = roundOf[i]; if (r && q.type !== 'round' && !isInfoItem(q)) questionsInRound[r] = (questionsInRound[r] || 0) + 1; });
              return qs.map((q, i) => {
              const info = getTypeInfo(q.type);
              const isSel = q._key === selected?._key;
              const warn = getWarnings(q).length > 0;
              const inRound = roundOf[i] && q.type !== 'round';
              if (inRound && collapsed[roundOf[i]]) return null;
              if (q.type === 'round') {
                const isCollapsed = !!collapsed[q._key];
                return (
                  <div key={q._key}>
                    {dropIndex === i && dragKey && <div className="h-1 bg-[#D4A12A] rounded-full mx-2 my-1" />}
                    <div draggable
                      onDragStart={e => { setDragKey(q._key); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDragKey(null); setDropIndex(null); }}
                      onDragOver={e => onDragOverItem(e, i)}
                      onClick={() => setSelectedKey(q._key)}
                      className={`group flex items-center gap-2 px-3 py-3 mt-2 rounded-xl cursor-pointer transition-colors bg-indigo-50 ${isSel ? 'ring-2 ring-[#D4A12A]' : 'hover:bg-indigo-100'} ${dragKey === q._key ? 'opacity-40' : ''}`}>
                      <button onClick={e => { e.stopPropagation(); setCollapsed(c => ({ ...c, [q._key]: !c[q._key] })); }} className="w-6 text-indigo-400 hover:text-indigo-700 font-bold" title={isCollapsed ? 'Aufklappen' : 'Zuklappen'}>{isCollapsed ? '▶' : '▼'}</button>
                      <span className="text-lg">🎬</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black tracking-widest text-indigo-400">RUNDE {getRoundNumber(qs, i)}</div>
                        <div className="text-sm font-bold text-indigo-900 truncate">{getItemTitle(q)}</div>
                      </div>
                      <span className="text-[11px] text-indigo-400 font-semibold">{questionsInRound[q._key] || 0} Fragen</span>
                      {warn && <span className="text-amber-500 text-sm" title={getWarnings(q).join('\n')}>⚠️</span>}
                      <button onClick={e => { e.stopPropagation(); deleteItem(q._key); }} className="opacity-0 group-hover:opacity-100 text-indigo-300 hover:text-red-500 p-1" title="Runden-Startfolie löschen (Fragen bleiben)"><Trash2 size={14}/></button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={q._key} className={inRound ? 'ml-4 border-l-2 border-indigo-100 pl-1' : ''}>
                  {dropIndex === i && dragKey && <div className="h-1 bg-[#D4A12A] rounded-full mx-2 my-1" />}
                  <div draggable
                    onDragStart={e => { setDragKey(q._key); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDragKey(null); setDropIndex(null); }}
                    onDragOver={e => onDragOverItem(e, i)}
                    onClick={() => setSelectedKey(q._key)}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isSel ? 'bg-amber-50 ring-2 ring-[#D4A12A]' : 'hover:bg-slate-50'} ${dragKey === q._key ? 'opacity-40' : ''} ${isInfoItem(q) ? 'bg-slate-50/60' : ''}`}>
                    <span className="text-slate-300 cursor-grab text-xs" title="Ziehen zum Verschieben">⋮⋮</span>
                    {q.type === 'slide' && q.imgUrl ? (
                      <QuizImage src={q.imgUrl} className="w-12 h-8 object-cover rounded-md border border-[#E6D6B8] flex-shrink-0" placeholderClassName="w-12 h-8 rounded-md bg-slate-100 flex-shrink-0" />
                    ) : (
                      <span className="w-12 h-8 flex items-center justify-center rounded-md bg-slate-100 text-lg flex-shrink-0">{info.icon}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${isInfoItem(q) ? 'text-slate-500 italic' : 'font-semibold text-[#14284B]'}`}>{getItemTitle(q)}</div>
                      <div className="text-[11px] text-slate-400 flex gap-2">
                        <span>{isInfoItem(q) ? info.label : `Frage ${getQuestionNumber(qs, i)} · ${info.label}`}</span>
                        {allowJokers && q.isJoker && <span>🌟</span>}
                      </div>
                    </div>
                    {warn && <span className="text-amber-500 text-sm" title={getWarnings(q).join('\n')}>⚠️</span>}
                    <button onClick={e => { e.stopPropagation(); duplicateItem(q._key); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-[#14284B] p-1" title="Duplizieren"><Copy size={14}/></button>
                    <button onClick={e => { e.stopPropagation(); deleteItem(q._key); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 p-1" title="Löschen"><Trash2 size={14}/></button>
                  </div>
                </div>
              );
            });
            })()}
            {dropIndex === qs.length && dragKey && <div className="h-1 bg-[#D4A12A] rounded-full mx-2 my-1" />}
          </div>
          <div className="p-3 border-t border-[#EFE3CC] grid grid-cols-2 gap-2">
            <button onClick={() => setPicker({ mode: 'add' })} className="col-span-2 bg-[#D4A12A] hover:bg-[#B98A1C] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm"><Plus size={18}/> Hinzufügen</button>
            <button onClick={() => addItem('round')} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 text-sm">🎬 Runde</button>
            <button onClick={() => openSlideImport(false)} disabled={!!importing} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 text-sm">
              {importing ? `${importing.done}/${importing.total} …` : <><ImageIcon size={16}/> Folien</>}
            </button>
          </div>
        </div>

        {/* Detail */}
        <div>
          {selected && showPreview && <EditorPreview qs={qs} index={selectedIndex} allowJokers={allowJokers} onClose={() => togglePreview(false)} />}
          {selected && !showPreview && (
            <button onClick={() => togglePreview(true)} className="mb-4 text-sm font-bold text-[#14284B] hover:text-[#0E1D38]">👀 Vorschau einblenden</button>
          )}
          {selected ? renderDetail(selected) : (
            <div className="bg-[#FFFBF3] rounded-3xl border-2 border-dashed border-[#DCC7A0] p-16 text-center text-slate-400">
              <div className="text-5xl mb-4">✨</div>
              <p className="mb-6">Dein Quiz ist noch leer.</p>
              <button onClick={() => setPicker({ mode: 'add' })} className="bg-[#D4A12A] text-white px-6 py-3 rounded-xl font-bold">Erstes Element hinzufügen</button>
            </div>
          )}
        </div>
      </div>

      {/* Versteckte Datei-Eingaben */}
      <input type="file" accept="image/*" multiple ref={slideImportRef} onChange={handleSlideImport} className="hidden" />
      <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {picker && (
        <TypePicker title={picker.mode === 'add' ? 'Was möchtest du hinzufügen?' : 'Typ ändern'} currentType={picker.mode === 'change' ? selected?.type : null}
          onPick={picker.mode === 'add' ? addItem : changeType} onClose={() => setPicker(null)} />
      )}

      {showSettings && (
        <Modal title="⚙️ Quiz-Einstellungen" onClose={() => setShowSettings(false)}>
          <div className="space-y-6">
            <div>
              <Toggle checked={allowJokers} onChange={setAllowJokers} label="🌟 Joker-Modus" hint="Jedes Team darf einmal pro Quiz bei einer Joker-Frage seine Punkte verdoppeln" />
            </div>

            <div>
              <FieldLabel>Für alle Fragen auf einmal</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => applyGlobal('showAnswers', true, '👁️ Antworten zeigen')} className="text-sm bg-slate-50 hover:bg-[#F8EFDF] text-slate-600 px-3 py-3 rounded-xl border border-slate-200">👁️ Antworten zeigen</button>
                <button onClick={() => applyGlobal('showAnswers', false, '🙈 Antworten verbergen')} className="text-sm bg-slate-50 hover:bg-[#F8EFDF] text-slate-600 px-3 py-3 rounded-xl border border-slate-200">🙈 Antworten verbergen</button>
                <button onClick={() => applyGlobal('showImg', true, '📱 Bilder aufs Handy')} className="text-sm bg-slate-50 hover:bg-[#F8EFDF] text-slate-600 px-3 py-3 rounded-xl border border-slate-200">📱 Bilder aufs Handy</button>
                <button onClick={() => applyGlobal('showImg', false, '🚫 Keine Bilder aufs Handy')} className="text-sm bg-slate-50 hover:bg-[#F8EFDF] text-slate-600 px-3 py-3 rounded-xl border border-slate-200">🚫 Keine Bilder aufs Handy</button>
              </div>
            </div>

            <div>
              <FieldLabel>🖼️ Folien aus PowerPoint</FieldLabel>
              <p className="text-xs text-slate-500 mb-3">In PowerPoint: Datei → Exportieren → PNG → „Alle Folien“. Dann hier alle Bilder auf einmal auswählen.</p>
              <button onClick={() => openSlideImport(true)} disabled={!!importing} className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl font-bold text-sm">
                {importing ? `Folien werden gespeichert … ${importing.done}/${importing.total}` : 'Folien ans Ende anhängen'}
              </button>
            </div>

            <div>
              <FieldLabel>📄 Fragen per Excel / CSV</FieldLabel>
              <div className="flex gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-[#F8EFDF] hover:bg-[#F0E3C8] text-[#14284B] py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><Upload size={16}/> CSV importieren</button>
                <button onClick={downloadCsvTemplate} className="flex-1 bg-[#FFFBF3] border border-[#E6D6B8] hover:bg-slate-50 text-slate-600 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><Download size={16}/> Vorlage</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-slate-800 text-white pl-5 pr-2 py-2 rounded-2xl shadow-2xl flex items-center gap-4 max-w-[90vw]">
          <span className="text-sm">{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo} className="bg-[#FFFBF3]/10 hover:bg-[#FFFBF3]/20 px-3 py-2 rounded-xl text-sm font-bold text-[#D4A12A]">Rückgängig</button>}
          <button onClick={() => setToast(null)} className="p-2 text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
      )}
    </div>
  );
}
