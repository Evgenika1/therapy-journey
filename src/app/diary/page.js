'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function Diary() {
  const [newEntry, setNewEntry] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntries();
  }, []);

  async function loadEntries() {
    const { data } = await supabase
      .from('diary_entries')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setEntries(data);
    setLoading(false);
  }

  async function addEntry() {
    if (!newEntry.trim()) return;
    const { data } = await supabase
      .from('diary_entries')
      .insert([{ content: newEntry, mood: '🙂', user_id: 'eva' }])
      .select();
    if (data) setEntries([data[0], ...entries]);
    setNewEntry('');
  }

  return (
    <div style={{background:'#F5F0EA',minHeight:'100vh',fontFamily:'DM Sans,sans-serif'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 32px',background:'rgba(255,255,255,0.8)',borderBottom:'0.5px solid rgba(240,112,64,0.2)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:'#F07040',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span style={{fontSize:11,fontWeight:700,color:'white'}}>tj</span>
          </div>
          <span style={{fontSize:12,letterSpacing:'3px',color:'#2C1A0E'}}>T H E R A P Y ™</span>
        </div>
        <div style={{display:'flex',gap:3,background:'rgba(245,200,66,0.15)',borderRadius:999,padding:3}}>
          {[['Dashboard','/'],['Sessions','/sessions'],['Progress','/progress'],['Diary','/diary']].map(([l,h],i)=>(
            <Link key={l} href={h} style={{borderRadius:999,padding:'6px 16px',fontSize:11,background:i===3?'#F5C842':'transparent',color:i===3?'#2C1A0E':'#A09080',fontWeight:i===3?600:400,textDecoration:'none'}}>{l}</Link>
          ))}
        </div>
        <div style={{width:32,height:32,borderRadius:'50%',background:'#F07040',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <span style={{fontSize:11,fontWeight:600,color:'white'}}>E</span>
        </div>
      </div>

      <div style={{maxWidth:900,margin:'0 auto',padding:'32px'}}>
        <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:6}}>Artifact ID 004</p>
        <h1 style={{fontSize:36,fontWeight:300,color:'#2C1A0E',marginBottom:28}}>My <strong style={{fontWeight:700}}>Diary</strong></h1>

        <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:24}}>
          <div>
            <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)',marginBottom:20}}>
              <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:12}}>NEW ENTRY</p>
              <textarea
                value={newEntry}
                onChange={e=>setNewEntry(e.target.value)}
                placeholder="What's on your mind today..."
                style={{width:'100%',height:100,border:'1px dashed rgba(245,200,66,0.5)',borderRadius:12,padding:14,fontSize:14,color:'#2C1A0E',resize:'none',outline:'none',fontFamily:'DM Sans,sans-serif',background:'rgba(245,200,66,0.03)',marginBottom:12}}
              />
              <button onClick={addEntry} style={{background:'#F07040',color:'white',border:'none',borderRadius:12,padding:'12px 24px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                SAVE ENTRY ✓
              </button>
            </div>

            {loading ? (
              <p style={{color:'#A09080',fontSize:13}}>Loading...</p>
            ) : entries.length === 0 ? (
              <div style={{background:'white',borderRadius:20,padding:32,textAlign:'center',boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
                <p style={{fontSize:32,marginBottom:12}}>📝</p>
                <p style={{fontSize:14,color:'#A09080'}}>No entries yet — write your first one!</p>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {entries.map((e,i)=>(
                  <div key={e.id} style={{background:'white',borderRadius:20,padding:22,boxShadow:'0 2px 10px rgba(44,26,14,0.06)',borderLeft:`3px solid ${i===0?'#F07040':'#F5C842'}`}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                      <span style={{fontSize:20}}>{e.mood}</span>
                      <div>
                        <p style={{fontSize:12,fontWeight:600,color:'#2C1A0E'}}>{new Date(e.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</p>
                        <p style={{fontSize:10,color:'#A09080'}}>↳ {new Date(e.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</p>
                      </div>
                    </div>
                    <p style={{fontSize:14,color:'#2C1A0E',lineHeight:1.6,fontWeight:300}}>{e.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{background:'white',borderRadius:20,padding:22,boxShadow:'0 2px 10px rgba(44,26,14,0.06)'}}>
              <p style={{fontSize:13,fontWeight:700,color:'#2C1A0E',marginBottom:16}}>This month</p>
              {[
                {label:'Entries',value:entries.length,accent:'#F07040'},
                {label:'Avg mood',value:'7.2',accent:'#F5C842'},
                {label:'Streak',value:'4 days',accent:'#F07040'},
              ].map(s=>(
                <div key={s.label} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'0.5px solid rgba(44,26,14,0.06)'}}>
                  <span style={{fontSize:13,color:'#A09080'}}>{s.label}</span>
                  <span style={{fontSize:15,fontWeight:700,color:s.accent}}>{s.value}</span>
                </div>
              ))}
            </div>
            <div style={{background:'linear-gradient(135deg,#F5C842,#F07040)',borderRadius:20,padding:22}}>
              <p style={{fontSize:11,color:'rgba(255,255,255,0.8)',marginBottom:8}}>Latest AI insight</p>
              <p style={{fontSize:13,color:'white',lineHeight:1.6,fontStyle:'italic'}}>"Your entries show growing self-awareness."</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}