'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function Sessions() {
  const [step, setStep] = useState(1);
  const [moodBefore, setMoodBefore] = useState(null);
  const [moodAfter, setMoodAfter] = useState(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [timer, setTimer] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const moods = ['😔','😟','😐','🙂','😊'];
  const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  function toggleRec() {
    if (!recording) {
      setRecording(true);
      const t = setInterval(() => setSeconds(s => s+1), 1000);
      setTimer(t);
    } else {
      setRecording(false);
      clearInterval(timer);
      setStep(2);
    }
  }

  async function saveSession() {
    setSaving(true);
    const { error } = await supabase
      .from('sessions')
      .insert([{
        user_id: 'eva',
        title: notes.slice(0, 50) || 'Session ' + new Date().toLocaleDateString(),
        transcript: notes,
        mood_before: moodBefore,
        mood_after: moodAfter,
        ai_analysis: {
          themes: ['Perfectionism', 'Self-worth'],
          insight: 'Your reaction to criticism comes from early expectations.',
          action: 'Use breathing exercise when feeling defensive.'
        }
      }]);
    setSaving(false);
    if (!error) setSaved(true);
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
            <Link key={l} href={h} style={{borderRadius:999,padding:'6px 16px',fontSize:11,background:i===1?'#F5C842':'transparent',color:i===1?'#2C1A0E':'#A09080',fontWeight:i===1?600:400,textDecoration:'none'}}>{l}</Link>
          ))}
        </div>
        <div style={{width:32,height:32,borderRadius:'50%',background:'#F07040',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <span style={{fontSize:11,fontWeight:600,color:'white'}}>E</span>
        </div>
      </div>

      <div style={{maxWidth:1000,margin:'0 auto',padding:'32px'}}>
        <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:6}}>Artifact ID 002</p>
        <h1 style={{fontSize:36,fontWeight:300,color:'#2C1A0E',marginBottom:28}}>New <strong style={{fontWeight:700}}>Session</strong></h1>

        <div style={{display:'flex',alignItems:'center',marginBottom:32}}>
          {['Record','Review','Save'].map((s,i) => (
            <div key={s} style={{display:'flex',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:28,height:28,borderRadius:'50%',background:step===i+1?'#F07040':step>i+1?'#90D890':'#E8E0D8',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <span style={{fontSize:12,fontWeight:600,color:step>=i+1?'white':'#A09080'}}>{i+1}</span>
                </div>
                <span style={{fontSize:13,color:step===i+1?'#F07040':'#A09080',fontWeight:step===i+1?600:400}}>{s}</span>
              </div>
              {i<2 && <div style={{width:40,height:1,background:'#E8E0D8',margin:'0 12px'}} />}
            </div>
          ))}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <div style={{display:'flex',flexDirection:'column',gap:16}}>

            <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
              <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:14}}>MOOD BEFORE SESSION</p>
              <div style={{display:'flex',gap:10}}>
                {moods.map((m,i) => (
                  <button key={i} onClick={()=>setMoodBefore(i)} style={{width:44,height:44,borderRadius:'50%',border:moodBefore===i?'2px solid #F07040':'1px solid #E8E0D8',background:moodBefore===i?'#FFF0EB':'transparent',fontSize:20,cursor:'pointer'}}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div style={{background:'white',borderRadius:20,padding:28,boxShadow:'0 2px 12px rgba(44,26,14,0.06)',display:'flex',flexDirection:'column',alignItems:'center',gap:18}}>
              <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080'}}>{recording?'RECORDING...':'PRESS TO START'}</p>
              <div style={{display:'flex',gap:3,alignItems:'center',height:40}}>
                {Array.from({length:20}).map((_,i)=>(
                  <div key={i} style={{width:4,borderRadius:2,background:recording?'#F07040':'#E8E0D8',height:'8px'}} />
                ))}
              </div>
              <p style={{fontSize:36,fontWeight:700,color:'#2C1A0E',letterSpacing:'3px'}}>{fmt(seconds)}</p>
              <button onClick={toggleRec} style={{width:72,height:72,borderRadius:'50%',background:recording?'#E84820':'#F07040',border:'none',cursor:'pointer',fontSize:28}}>
                {recording?'⏸':'🎙'}
              </button>
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            {step===1 && (
              <div style={{border:'1px dashed rgba(245,200,66,0.5)',borderRadius:16,padding:24,background:'rgba(245,200,66,0.05)'}}>
                <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:10}}>NOTES / WHAT TO DISCUSS</p>
                <textarea
                  value={notes}
                  onChange={e=>setNotes(e.target.value)}
                  placeholder="What's on your mind today..."
                  style={{width:'100%',height:120,borderRadius:10,border:'1px solid #E8E0D8',padding:12,fontSize:13,color:'#2C1A0E',resize:'none',outline:'none',background:'white',fontFamily:'DM Sans,sans-serif'}}
                />
              </div>
            )}

            {step>=2 && (
              <>
                <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                    <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080'}}>YOUR NOTES</p>
                    <span style={{background:'#E8F8E8',borderRadius:999,padding:'4px 12px',fontSize:11,color:'#3A7A3A'}}>✓ Saved</span>
                  </div>
                  <p style={{fontSize:13,color:'#2C1A0E',lineHeight:1.6}}>{notes || 'No notes written.'}</p>
                </div>

                <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
                  <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:14}}>MOOD AFTER SESSION</p>
                  <div style={{display:'flex',gap:10,marginBottom:16}}>
                    {moods.map((m,i) => (
                      <button key={i} onClick={()=>setMoodAfter(i)} style={{width:44,height:44,borderRadius:'50%',border:moodAfter===i?'2px solid #F5C842':'1px solid #E8E0D8',background:moodAfter===i?'#FFF8E0':'transparent',fontSize:20,cursor:'pointer'}}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <button onClick={()=>setStep(3)} style={{width:'100%',background:'#F07040',color:'white',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:600,cursor:'pointer'}}>
                    NEXT →
                  </button>
                </div>
              </>
            )}

            {step===3 && (
              <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
                <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:16}}>SAVE SESSION</p>
                {[
                  {label:'Mood before',value:moodBefore!==null?moods[moodBefore]:'—'},
                  {label:'Mood after',value:moodAfter!==null?moods[moodAfter]:'—'},
                  {label:'Duration',value:fmt(seconds)},
                ].map(r=>(
                  <div key={r.label} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'0.5px solid rgba(44,26,14,0.06)'}}>
                    <span style={{fontSize:13,color:'#A09080'}}>{r.label}</span>
                    <span style={{fontSize:14,color:'#2C1A0E'}}>{r.value}</span>
                  </div>
                ))}
                {saved ? (
                  <div style={{background:'#E8F8E8',borderRadius:12,padding:16,textAlign:'center',marginTop:16}}>
                    <p style={{fontSize:16,marginBottom:4}}>🎉</p>
                    <p style={{fontSize:14,fontWeight:600,color:'#3A7A3A'}}>Session saved!</p>
                    <Link href="/" style={{display:'block',marginTop:10,fontSize:13,color:'#F07040'}}>← Back to Dashboard</Link>
                  </div>
                ) : (
                  <button onClick={saveSession} disabled={saving} style={{width:'100%',background:saving?'#A09080':'#F5C842',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:600,cursor:'pointer',color:'#2C1A0E',marginTop:16}}>
                    {saving?'SAVING...':'SAVE SESSION ✓'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}