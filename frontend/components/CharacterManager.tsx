import React, { useState } from 'react';
import { Loader2, Plus, Edit, X, Search, Check, Upload, Trash2, Sparkles } from 'lucide-react';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { videoGenerationAPI } from '../services/api';

interface CharacterManagerProps {
  jobId: string;
  draft: any;
  setDraft: React.Dispatch<React.SetStateAction<any>>;
  setStep: (step: number) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onApproveAll?: () => void;
}

export const CharacterManager: React.FC<CharacterManagerProps> = ({ jobId, draft, setDraft, setStep, busy, setBusy, onApproveAll }) => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  
  const [editingChar, setEditingChar] = useState<any>(null);
  const [previewImage, setPreviewImage] = useState('');
  
  // Local edit states
  const [editName, setEditName] = useState('');
  const [editAge, setEditAge] = useState('25');
  const [editGender, setEditGender] = useState('Female');
  const [editRole, setEditRole] = useState('Character');
  const [editAppearance, setEditAppearance] = useState('');
  const [editHair, setEditHair] = useState('');
  const [editImage, setEditImage] = useState('');

  const openEditor = (char?: any) => {
    if (char) {
      setEditingChar(char);
      setEditName(char.name || '');
      setEditAge(char.appearance?.ageAppearance || char.age || '25');
      setEditGender(char.appearance?.gender || char.gender || 'Any');
      setEditRole(char.role || char.appearance?.role || 'Character');
      setEditAppearance(char.appearance ? JSON.stringify(char.appearance) : char.appearanceStr || '');
      setEditHair(char.hair?.style || char.hairStr || '');
      setEditImage(char.image || '');
    } else {
      const newId = `CH_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      setEditingChar({ characterId: newId, isNew: true });
      setEditName('');
      setEditAge('25');
      setEditGender('Female');
      setEditRole('Character');
      setEditAppearance('');
      setEditHair('');
      setEditImage('');
    }
  };

  const closeEditor = () => {
    setEditingChar(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setEditImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const saveCharacter = async () => {
    try {
      setBusy(true);
      const updatedChars = [...(draft?.characters || [])];
      let cid = editingChar.characterId || editingChar.id;
      const idx = updatedChars.findIndex((c: any) => c.id === cid);
      
      const newChar = { 
        id: cid, 
        characterId: cid,
        name: editName, 
        role: editRole, 
        age: editAge,
        gender: editGender,
        appearanceStr: editAppearance,
        hairStr: editHair,
        image: editImage 
      };
      
      if (idx > -1) {
        updatedChars[idx] = newChar;
      } else {
        updatedChars.push(newChar);
      }
      
      await videoGenerationAPI.updateDraft(jobId, { characters: updatedChars });
      setDraft((prev: any) => prev ? { ...prev, characters: updatedChars } : prev);
      closeEditor();
    } catch (e: any) {
      console.error("Failed to save character:", e);
      alert("Error saving character");
    } finally {
      setBusy(false);
    }
  };

  const generateCharacter = async () => {
    try {
      setBusy(true);
      const res = await videoGenerationAPI.generateCharacterPreview({
        name: editName,
        age: editAge,
        gender: editGender,
        hairStyle: editHair,
        appearance: editAppearance,
        artStyle: 'Realistic / Photography'
      });
      if (res?.imageUrl) {
        setEditImage(res.imageUrl);
      }
    } catch (e) {
      console.error(e);
      alert("Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const autoGeneratePending = async () => {
    const pendingChars = allCharacters.filter((c: any) => !c.image);
    if (pendingChars.length === 0) return;
    
    try {
      setBusy(true);
      let updatedChars = [...(draft?.characters || [])];
      
      for (const char of pendingChars) {
        const cid = char.id || char.characterId;
        const res = await videoGenerationAPI.generateCharacterPreview({
          name: char.name || '',
          age: char.appearance?.ageAppearance || char.age || '25',
          gender: char.appearance?.gender || char.gender || 'Any',
          hairStyle: char.hair?.style || char.hairStr || '',
          appearance: char.appearance ? JSON.stringify(char.appearance) : char.appearanceStr || '',
          artStyle: 'Realistic / Photography'
        });
        
        if (res?.imageUrl) {
          const newChar = {
            id: cid,
            characterId: cid,
            name: char.name || '',
            role: char.role || char.appearance?.role || 'Character',
            age: char.appearance?.ageAppearance || char.age || '25',
            gender: char.appearance?.gender || char.gender || 'Any',
            appearanceStr: char.appearance ? JSON.stringify(char.appearance) : char.appearanceStr || '',
            hairStr: char.hair?.style || char.hairStr || '',
            image: res.imageUrl
          };
          
          const idx = updatedChars.findIndex((c: any) => c.id === cid);
          if (idx > -1) {
            updatedChars[idx] = newChar;
          } else {
            updatedChars.push(newChar);
          }
        }
      }
      
      await videoGenerationAPI.updateDraft(jobId, { characters: updatedChars });
      setDraft((prev: any) => prev ? { ...prev, characters: updatedChars } : prev);
      
    } catch (e: any) {
      console.error("Failed to auto-generate characters:", e);
      alert("Error auto-generating characters");
    } finally {
      setBusy(false);
    }
  };

  const deleteCharacter = async (id: string) => {
    if (!confirm('Are you sure you want to delete this character?')) return;
    try {
      setBusy(true);
      const updatedChars = (draft?.characters || []).filter((c: any) => c.id !== id && c.characterId !== id);
      await videoGenerationAPI.updateDraft(jobId, { characters: updatedChars });
      setDraft((prev: any) => prev ? { ...prev, characters: updatedChars } : prev);
    } finally {
      setBusy(false);
    }
  };

  // Merge AI-generated characters from the bible with our state array
  const stateChars = draft?.characters || [];

  const charMap = new Map();
  stateChars.forEach((c: any) => {
    charMap.set(c.id || c.characterId, { ...c, id: c.id || c.characterId, source: 'manual' });
  });
  const allCharacters = Array.from(charMap.values());

  const panelClass = "bg-white dark:bg-[#121212] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm";
  const inputClass = `w-full px-4 py-2 rounded-xl border ${theme.border} bg-white dark:bg-black ${theme.text} focus:outline-none focus:ring-2 focus:ring-[#ffcc29]/50 transition-shadow`;

  return (
    <div className={`p-6 space-y-6 ${panelClass}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-xl font-bold ${theme.text}`}>Character Manager</h2>
        <div className="flex gap-3">
          {allCharacters.filter((c: any) => !c.image).length > 0 && (
            <button onClick={autoGeneratePending} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium rounded-xl transition shadow-sm">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Auto-Generate Pending
            </button>
          )}
          <button onClick={() => openEditor()} className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-xl transition">
            <Plus className="w-4 h-4" /> Add Character
          </button>
        </div>
      </div>

      {!editingChar ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b ${theme.border}`}>
                  <th className={`p-3 ${theme.textMuted}`}>Image</th>
                  <th className={`p-3 ${theme.textMuted}`}>Name</th>
                  <th className={`p-3 ${theme.textMuted}`}>Role</th>
                  <th className={`p-3 ${theme.textMuted}`}>Status</th>
                  <th className={`p-3 text-right ${theme.textMuted}`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allCharacters.map((char: any) => (
                  <tr key={char.id} className={`border-b ${theme.border} hover:bg-slate-50 dark:hover:bg-slate-900/50`}>
                    <td className="p-3">
                      {char.image ? (
                        <img src={char.image} className="w-16 h-16 rounded-xl object-cover border cursor-pointer hover:opacity-80 transition" alt={char.name} onClick={() => setPreviewImage(char.image)} />
                      ) : (
                        <div className={`w-16 h-16 rounded-xl border flex items-center justify-center ${theme.border} bg-slate-100 dark:bg-slate-800`}>
                          <span className="text-xs text-slate-400">None</span>
                        </div>
                      )}
                    </td>
                    <td className={`p-3 font-semibold ${theme.text}`}>{char.name || 'Unnamed'}</td>
                    <td className={`p-3 ${theme.text}`}>{char.role || char.appearance?.role || 'Character'}</td>
                    <td className={`p-3`}>
                      {char.image ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400">✓ Ready</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700/60 text-slate-400">No Reference</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditor(char)} disabled={busy} className="p-2 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-lg transition">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteCharacter(char.id)} disabled={busy} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-lg transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {allCharacters.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">No characters yet. The AI Director will suggest characters automatically after you generate the story, or click 'Add Character' to create one manually.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Approve All button */}
          {allCharacters.length > 0 && onApproveAll && (
            <div className="flex justify-end pt-4 border-t border-slate-800">
              <button
                onClick={onApproveAll}
                disabled={busy}
                className="flex items-center gap-2 px-6 py-3 bg-[#ffcc29] text-black font-bold rounded-xl hover:bg-[#e6b825] transition-all shadow-lg shadow-[#ffcc29]/20 disabled:opacity-50"
              >
                <Check className="w-5 h-5" />
                Approve All Characters →
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-6">
          <div className="flex justify-between items-center border-b pb-4 dark:border-slate-800">
            <h3 className={`font-bold text-lg ${theme.text}`}>{editingChar.isNew ? 'Create Character' : 'Edit Character'} ({editingChar.characterId || editingChar.id})</h3>
            <button onClick={closeEditor} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition"><X className="w-5 h-5" /></button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Character Name</label>
                <input type="text" className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="e.g. Priya" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Age</label>
                  <input type="text" className={inputClass} value={editAge} onChange={(e) => setEditAge(e.target.value)} placeholder="e.g. 26" />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Gender</label>
                  <input type="text" className={inputClass} value={editGender} onChange={(e) => setEditGender(e.target.value)} placeholder="e.g. Female" />
                </div>
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Role</label>
                <input type="text" className={inputClass} value={editRole} onChange={(e) => setEditRole(e.target.value)} placeholder="e.g. Bride" />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Appearance Description</label>
                <textarea className={`${inputClass} min-h-[80px]`} value={editAppearance} onChange={(e) => setEditAppearance(e.target.value)} placeholder="Physical traits, face shape, skin tone, etc." />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Hair Style</label>
                <input type="text" className={inputClass} value={editHair} onChange={(e) => setEditHair(e.target.value)} placeholder="e.g. Long black braid with jasmine" />
              </div>
            </div>
            
            <div className="space-y-4">
              <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Character Reference Image</label>
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center min-h-[250px] relative bg-slate-50 dark:bg-slate-900/50">
                {editImage ? (
                  <div className="relative w-full h-full flex items-center justify-center group">
                    <img src={editImage} className="max-h-[300px] object-contain rounded-lg" alt="Preview" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg gap-3">
                      <button onClick={generateCharacter} disabled={busy} className="px-3 py-2 bg-indigo-500 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-600">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Regenerate
                      </button>
                      <label className="px-3 py-2 bg-slate-700 text-white rounded-lg flex items-center gap-2 hover:bg-slate-600 cursor-pointer">
                        <Upload className="w-4 h-4" /> Upload
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="flex justify-center gap-3">
                      <button onClick={generateCharacter} disabled={busy} className="px-4 py-2 bg-indigo-500 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-600 transition shadow-sm">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI Generate
                      </button>
                      <label className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer shadow-sm">
                        <Upload className="w-4 h-4" /> Upload Custom
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                      </label>
                    </div>
                    <p className="text-xs text-slate-400">Generate an AI character using the descriptions or upload your own reference image (1:1 ratio recommended).</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex justify-end gap-3 pt-4 border-t dark:border-slate-800">
            <button onClick={closeEditor} disabled={busy} className="px-6 py-2 rounded-xl font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button onClick={saveCharacter} disabled={busy} className="px-6 py-2 rounded-xl font-medium bg-[#ffcc29] text-black hover:bg-[#e6b825] transition-colors disabled:opacity-50 flex items-center gap-2">
              <Check className="w-4 h-4" /> Save Character
            </button>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setPreviewImage('')}>
          <div className="relative max-w-4xl max-h-full">
            <button onClick={() => setPreviewImage('')} className="absolute -top-4 -right-4 p-2 bg-white text-black rounded-full shadow-lg hover:bg-gray-200">
              <X className="w-6 h-6" />
            </button>
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
};
