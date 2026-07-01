import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const res = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expires_in: 3600 }),
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
