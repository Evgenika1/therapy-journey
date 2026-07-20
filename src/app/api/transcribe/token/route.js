import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const res = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=600', {
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: 500 });
    }
    const { token } = await res.json();
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
