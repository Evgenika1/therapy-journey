'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function Progress() {
  const [period, setPeriod] = useState('1m');

  const stats = [
    { label: 'Sessions', value: '12', note: '01 — total', accent: '#F07040', bg: '#FFF0EB' },
    { label: 'Mood Lift', value: '+2.1', note: '02 — avg', accent: '#F5C842', bg: '#FFF8E0' },
    { label: 'Insights', value: '5', note: '03 — recorded', accent: '#F5C842', bg: '#FFFAE8' },
    { label: 'Streak', value: '4', note: '04 — weeks', accent: '#F07040', bg: '#FFF0E8' },
  ];

  const themes = [
    { label: 'Perfectionism', pct: 72 },
    { label: 'Work stress', pct: 58 },
    { label: 'Boundaries', pct: 44 },
    { label: 'Self-worth', pct: 31 },
  ];

  const milestones = [
    { date: 'Mar 15', text: 'First calm session', color: '#E8F8E8', dot: '#3A7A3A' },
    { date: 'Mar 8',  text: 'Named a pattern', color: '#FFF8E0', dot: '#E8A820' },
    { date: 'Feb 28', text: '10 sessions done', color: '#FFF0EB', dot: '#F07040' },
    { date: 'Feb 12', text: 'Mood hit 8+', color: '#FFFAE8', dot: '#F5C842' },
  ];

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
            <Link key={label} href={href} style={{borderRadius:999,padding:'6px 16px',fontSize:11,background:i===2?'#F5C842':'transparent',color:i===2?'#2C1A0E':'#A09080',fontWeight:i===2?600:400,textDecoration:'none'}}>
              {label}
            </Link>
          ))}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {['1m','3m','all'].map(p => (
            <button key={p} onClick={()=>setPeriod(p)} style={{borderRadius:999,padding:'5px 14px',border:period===p?'1px solid #F5C842':'0.5px solid rgba(240,112,64,0.2)',cursor:'pointer',fontSize:10,background:period===p?'rgba(245,200,66,0.2)':'transparent',color:period===p?'#2C1A0E':'#A09080'}}>
              {p.toUpperCase()}
            </button>
          ))}
          <div style={{width:32,height:32,borderRadius:'50%',background:'#F07040',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span style={{fontSize:11,fontWeight:600,color:'white'}}>E</span>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:'0 auto',padding:'32px'}}>
        <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:6}}>Artifact ID 003</p>
        <h1 style={{fontSize:36,fontWeight:300,color:'#2C1A0E',marginBottom:28}}>Your <strong style={{fontWeight:700}}>Progress</strong></h1>

        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
          {stats.map(s => (
            <div key={s.label} style={{background:'white',borderRadius:16,padding:'16px 18px',boxShadow:'0 2px 10px rgba(44,26,14,0.06)',borderTop:`2px solid ${s.accent}`}}>
              <p style={{fontSize:10,letterSpacing:'1px',color:'#A09080',marginBottom:8}}>{s.note.toUpperCase()}</p>
              <p style={{fontSize:36,fontWeight:700,color:'#2C1A0E',lineHeight:1,marginBottom:4}}>{s.value}</p>
              <p style={{fontSize:12,color:'#A09080'}}>{s.label}</p>
            </div>
          ))}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>

          <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <p style={{fontSize:14,fontWeight:700,color:'#2C1A0E'}}>Mood before & after</p>
              <div style={{display:'flex',gap:16,fontSize:11,color:'#A09080'}}>
                <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{display:'inline-block',width:20,height:2,background:'rgba(240,112,64,0.3)',borderRadius:2}}></span>before</span>
                <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{display:'inline-block',width:20,height:2,background:'#F07040',borderRadius:2}}></span>after</span>
              </div>
            </div>
            <div style={{height:160,background:'#FDFAF5',borderRadius:12,display:'flex',alignItems:'flex-end',padding:'12px',gap:8,overflow:'hidden'}}>
              {[6,7,7,8,7,8,9].map((v,i) => (
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',gap:3,alignItems:'center'}}>
                  <div style={{width:'100%',background:'#F07040',borderRadius:'4px 4px 0 0',height:`${v*14}px`,opacity:0.85}} />
                  <div style={{width:'100%',background:'rgba(240,112,64,0.25)',borderRadius:'4px 4px 0 0',height:`${[4,5,4,5,5,6,6][i]*14}px`}} />
                </div>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
              {['Mar 1','Mar 5','Mar 8','Mar 10','Mar 13','Mar 15','Mar 17'].map(d => (
                <span key={d} style={{fontSize:9,color:'#A09080'}}>{d}</span>
              ))}
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)',flex:1}}>
              <p style={{fontSize:14,fontWeight:700,color:'#2C1A0E',marginBottom:16}}>Most discussed themes</p>
              {themes.map(t => (
                <div key={t.label} style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                    <span style={{fontSize:13,color:'#2C1A0E'}}>{t.label}</span>
                    <span style={{fontSize:11,color:'#A09080'}}>{t.pct}%</span>
                  </div>
                  <div style={{height:6,background:'rgba(240,112,64,0.1)',borderRadius:4,overflow:'hidden'}}>
                    <div style={{width:`${t.pct}%`,height:'100%',background:'linear-gradient(90deg,#F5C842,#F07040)',borderRadius:4}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{background:'white',borderRadius:20,padding:24,boxShadow:'0 2px 12px rgba(44,26,14,0.06)'}}>
          <p style={{fontSize:14,fontWeight:700,color:'#2C1A0E',marginBottom:16}}>Milestones</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {milestones.map(m => (
              <div key={m.date} style={{background:m.color,borderRadius:12,padding:'12px 14px',display:'flex',gap:10,alignItems:'flex-start'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:m.dot,marginTop:4,flexShrink:0}} />
                <div>
                  <p style={{fontSize:12,fontWeight:500,color:'#2C1A0E',marginBottom:2}}>{m.text}</p>
                  <p style={{fontSize:10,color:'#A09080'}}>↳ {m.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:20}}>
          <div style={{border:'1px solid rgba(245,200,66,0.5)',borderRadius:8,padding:'8px 14px',background:'rgba(245,200,66,0.08)'}}>
            <p style={{fontSize:8,letterSpacing:'1.5px',color:'#A09080',marginBottom:2}}>CURRENT PHASE MARKER</p>
            <p style={{fontSize:12,color:'#2C1A0E'}}>17 · 03 · 26</p>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:10,letterSpacing:'2px',color:'#E8A820'}}>STABLE</span>
            <div style={{width:1,height:16,background:'rgba(245,200,66,0.4)'}} />
            <span style={{fontSize:10,letterSpacing:'2px',color:'#A09080'}}>OVERLOAD</span>
          </div>
        </div>
      </div>
    </div>
  );
}
