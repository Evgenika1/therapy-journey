mkdir -p src/app/diary && cat > src/app/diary/page.js << 'ENDOFFILE'
'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function Diary() {
  const [newEntry, setNewEntry] = useState('');
  const [entries, setEntries] = useState([
    { id:1, date:'Mar 15, 2026', time:'21:30', text:'I noticed I was much calmer in difficult conversations today. Something is shifting.', mood:'🙂' },
    { id:2, date:'Mar 13, 2026', time:'20:15', text:'Had a hard day but managed to name the feeling — that helped a lot more than I expected.', mood:'😐' },
    { id:3, date:'Mar 11, 2026', time:'22:00', text:'Felt proud of myself for the first time in a while. Small win but it matters.', mood:'😊' },
    { id:4, date:'Mar 8, 2026',  time:'19:45', text:'Difficult conversation with a colleague. I reacted strongly — need to explore this pattern more.', mood:'😟' },
  ]);

  function addEntry() {
    if (!newEntry.trim()) return;
    setEntries([{ id: Date.now(), date: 'Mar 21, 2026', time: 'now', text: newEntry, mood: '🙂' }, ...entries]);
    setNewEntry('');
  }

  const nav = [['Dashboard','/'],['Sessions','/sessions'],['Progress','/progress'],['Diary','/diary']];

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
          {nav.map(([label,href],i) => (
            <Link key={label} href={href} style={{borderRadius:999,padding:'6px 16px',fontSize:11,background:i===3?'#F5C842':'transparent',color:i===3?'#2C1A0E':'#A09080',fontWeight:i===3?600:400,textDecoration:'none'}}>
              {label}
            </Link>
          ))}
        </div>
        <div style={{width:32,height:32,borderRadius:'50%',background:'#F07040',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <span style={{fontSize:11,fontWeight:600,color:'white'}}>E</span>
        </div>
      </div>

      <div style={{maxWidth:900,margin:'0 auto',padding:'32px'}}>
        <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:6}}>Artifact ID 004</p>
        <h1 style={{fontSize:36,fontWeight:300,color:'#2C1A0E',marginBottom:28}}>My <strong style={{fontWeight:700}}>Diary</strong></h1>

        <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:24}}>

          <div>
            <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)',marginBottom:20}}>
              <p style={{fontSize:10,letterSpacing:'1.5px',color:'#A09080',marginBottom:12}}>NEW ENTRY</p>
              <div style={{border:'1px dashed rgba(245,200,66,0.5)',borderRadius:12,padding:16,background:'rgba(245,200,66,0.03)',position:'relative',marginBottom:12}}>
                <div style={{position:'absolute',width:5,height:5,background:'#F5C842',borderRadius:'50%',top:-3,left:-3}} />
                <div style={{position:'absolute',width:5,height:5,background:'#F07040',borderRadius:'50%',bottom:-3,right:-3}} />
                <textarea
                  value={newEntry}
                  onChange={e=>setNewEntry(e.target.value)}
                  placeholder="What's on your mind today..."
                  style={{width:'100%',height:120,border:'none',background:'transparent',fontSize:14,color:'#2C1A0E',resize:'none',outline:'none',fontFamily:'DM Sans,sans-serif',lineHeight:1.6}}
                />
              </div>
              <button onClick={addEntry} style={{background:'#F07040',color:'white',border:'none',borderRadius:12,padding:'12px 24px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                SAVE ENTRY ✓
              </button>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {entries.map((e,i) => (
                <div key={e.id} style={{background:'white',borderRadius:20,padding:22,boxShadow:'0 2px 10px rgba(44,26,14,0.06)',borderLeft:`3px solid ${i===0?'#F07040':i===1?'#F5C842':i===2?'#F07040':'#A09080'}`}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:20}}>{e.mood}</span>
                      <div>
                        <p style={{fontSize:12,fontWeight:600,color:'#2C1A0E'}}>{e.date}</p>
                        <p style={{fontSize:10,color:'#A09080',fontFamily:'Courier Prime,monospace',letterSpacing:'0.5px'}}>↳ {e.time}</p>
                      </div>
                    </div>
                    <button style={{background:'none',border:'none',color:'#A09080',cursor:'pointer',fontSize:16}}>···</button>
                  </div>
                  <p style={{fontSize:14,color:'#2C1A0E',lineHeight:1.6,fontWeight:300}}>{e.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{background:'white',borderRadius:20,padding:22,boxShadow:'0 2px 10px rgba(44,26,14,0.06)'}}>
              <p style={{fontSize:13,fontWeight:700,color:'#2C1A0E',marginBottom:16}}>This month</p>
              {[
                {label:'Entries written',value:'12',accent:'#F07040'},
                {label:'Avg mood',value:'7.2',accent:'#F5C842'},
                {label:'Streak',value:'4 days',accent:'#F07040'},
              ].map(s => (
                <div key={s.label} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'0.5px solid rgba(44,26,14,0.06)'}}>
                  <span style={{fontSize:13,color:'#A09080'}}>{s.label}</span>
                  <span style={{fontSize:15,fontWeight:700,color:s.accent}}>{s.value}</span>
                </div>
              ))}
            </div>

            <div style={{background:'linear-gradient(135deg,#F5C842,#F07040)',borderRadius:20,padding:22}}>
              <p style={{fontSize:11,color:'rgba(255,255,255,0.8)',marginBottom:8}}>Latest AI insight</p>
              <p style={{fontSize:13,color:'white',lineHeight:1.6,fontStyle:'italic'}}>"Your entries show growing self-awareness. You are learning to name emotions before reacting."</p>
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
ENDOFFILE