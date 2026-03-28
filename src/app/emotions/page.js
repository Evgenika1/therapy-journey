'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function Emotions() {
  const [selected, setSelected] = useState(null);
  const [intensity, setIntensity] = useState(5);
  const [logs, setLogs] = useState([]);
  const [saved, setSaved] = useState(false);

  const emotions = [
    { name:'Joy', emoji:'😊', color:'#F5C842', bg:'#FFF8E0' },
    { name:'Calm', emoji:'😌', color:'#90C070', bg:'#E8F5E0' },
    { name:'Sad', emoji:'😢', color:'#8AB4D4', bg:'#E0EEF8' },
    { name:'Anxious', emoji:'😰', color:'#F07040', bg:'#FFF0EB' },
    { name:'Angry', emoji:'😠', color:'#E84820', bg:'#FDE8E0' },
    { name:'Grateful', emoji:'🙏', color:'#C070C0', bg:'#F5E0F5' },
    { name:'Lonely', emoji:'😔', color:'#8888AA', bg:'#EEEEF5' },
    { name:'Love', emoji:'❤️', color:'#E85080', bg:'#FDE0E8' },
  ];

  useEffect(() => { loadLogs(); }, []);

  async function loadLogs() {
    const { data } = await supabase
      .from('emotion_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setLogs(data);
  }

  async function logEmotion() {
    if (!selected) return;
    const { data } = await supabase
      .from('emotion_logs')
      .insert([{ user_id:'eva', emotion:selected, intensity }])
      .select();
    if (data) {
      setLogs([data[0], ...logs]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setSelected(null);
      setIntensity(5);
    }
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
            <Link key={l} href={h} style={{borderRadius:999,padding:'6px 16px',fontSize:11,background:'transparent',color:'#A09080',textDecoration:'none'}}>{l}</Link>
          ))}
        </div>
        <div style={{width:32,height:32,borderRadius:'50%',background:'#F07040',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <span style={{fontSize:11,fontWeight:600,color:'white'}}>E</span>
        </div>
      </div>

      <div style={{maxWidth:900,margin:'0 auto',padding:'32px'}}>
        <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:6}}>Artifact ID 005</p>
        <h1 style={{fontSize:36,fontWeight:300,color:'#2C1A0E',marginBottom:28}}>My <strong style={{fontWeight:700}}>Emotions</strong></h1>

        <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:24}}>
          <div>
            <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)',marginBottom:20}}>
              <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:16}}>HOW ARE YOU FEELING RIGHT NOW?</p>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
                {emotions.map(e=>(
                  <button key={e.name} onClick={()=>setSelected(e.name)} style={{padding:'14px 8px',borderRadius:16,border:selected===e.name?`2px solid ${e.color}`:'1px solid #E8E0D8',background:selected===e.name?e.bg:'white',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:6,transition:'all 0.15s'}}>
                    <span style={{fontSize:28}}>{e.emoji}</span>
                    <span style={{fontSize:11,color:'#2C1A0E',fontWeight:selected===e.name?600:400}}>{e.name}</span>
                  </button>
                ))}
              </div>

              {selected && (
                <div style={{borderTop:'0.5px solid rgba(44,26,14,0.08)',paddingTop:16}}>
                  <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:10}}>
                    INTENSITY — {intensity}/10
                  </p>
                  <input
                    type="range" min="1" max="10" value={intensity}
                    onChange={e=>setIntensity(Number(e.target.value))}
                    style={{width:'100%',marginBottom:16,accentColor:'#F07040'}}
                  />
                  <button onClick={logEmotion} style={{background:'#F07040',color:'white',border:'none',borderRadius:12,padding:'12px 24px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                    LOG EMOTION ✓
                  </button>
                  {saved && <span style={{marginLeft:12,fontSize:13,color:'#3A7A3A'}}>✓ Saved!</span>}
                </div>
              )}
            </div>

            <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
              <p style={{fontSize:14,fontWeight:700,color:'#2C1A0E',marginBottom:16}}>Recent emotion log</p>
              {logs.length === 0 ? (
                <p style={{fontSize:13,color:'#A09080',textAlign:'center',padding:'20px 0'}}>No emotions logged yet</p>
              ) : logs.map((l,i)=>(
                <div key={l.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:i<logs.length-1?'0.5px solid rgba(44,26,14,0.06)':'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <span style={{fontSize:20}}>{emotions.find(e=>e.name===l.emotion)?.emoji || '😐'}</span>
                    <div>
                      <p style={{fontSize:13,fontWeight:500,color:'#2C1A0E'}}>{l.emotion}</p>
                      <p style={{fontSize:10,color:'#A09080'}}>↳ {new Date(l.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:'#F07040'}}>{l.intensity}/10</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{background:'white',borderRadius:20,padding:22,boxShadow:'0 2px 10px rgba(44,26,14,0.06)'}}>
              <p style={{fontSize:13,fontWeight:700,color:'#2C1A0E',marginBottom:16}}>This week</p>
              {[
                {label:'Most felt', value: logs[0]?.emotion || '—', accent:'#F5C842'},
                {label:'Avg intensity', value: logs.length ? (logs.reduce((a,b)=>a+b.intensity,0)/logs.length).toFixed(1) : '—', accent:'#F07040'},
                {label:'Logged', value: `${logs.length} times`, accent:'#F07040'},
              ].map(s=>(
                <div key={s.label} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'0.5px solid rgba(44,26,14,0.06)'}}>
                  <span style={{fontSize:13,color:'#A09080'}}>{s.label}</span>
                  <span style={{fontSize:15,fontWeight:700,color:s.accent}}>{s.value}</span>
                </div>
              ))}
            </div>

            <div style={{background:'linear-gradient(135deg,#F5C842,#F07040)',borderRadius:20,padding:22}}>
              <p style={{fontSize:11,color:'rgba(255,255,255,0.8)',marginBottom:8}}>AI pattern</p>
              <p style={{fontSize:13,color:'white',lineHeight:1.6,fontStyle:'italic'}}>"You tend to feel anxious on weekdays and calmer on weekends. Work may be a key trigger."</p>
            </div>

            <div style={{border:'1px solid rgba(245,200,66,0.5)',borderRadius:12,padding:'12px 16px',background:'rgba(245,200,66,0.08)'}}>
              <p style={{fontSize:8,letterSpacing:'1.5px',color:'#A09080',marginBottom:2}}>CURRENT PHASE MARKER</p>
              <p style={{fontSize:12,color:'#2C1A0E'}}>17 · 03 · 26</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}