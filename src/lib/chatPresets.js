// What the chat offers before you have typed anything.
//
// Shared by both chat surfaces — the panel beside a session, and the standalone
// AI Chat screen. These lived in the sessions page while only that page had
// them; two copies of prompts worded this carefully would drift apart on the
// first edit to either one.

export const CHAT_SUGGESTIONS = [
  'What emotions came up in my last session?',
  'Summarize the key themes across my sessions',
  'What patterns do you notice in my progress?',
  'What should I focus on for next session?',
];

// ─── CBT presets ──────────────────────────────────────────────────────────────
//
// Two guided prompts that go further than the plain suggestions above: each
// carries its own system-prompt directive. The tone rules live in the system
// turn on purpose — as a user message they would render as the person's own
// chat bubble, get written into the saved history, and be the first thing the
// model drifts away from over a long thread.
//
// Miru is a journal, not a clinician, and these two prompts are the closest it
// comes to clinical language — so both are written to *suggest* rather than to
// label, and both are required to end by pointing back at the user's own
// therapist. `directive` is applied to every following turn of the thread too
// (see chatDirective), so a follow-up answer keeps the same gentle register
// instead of snapping back to the generic companion voice mid-conversation.
export const CBT_PRESETS = [
  {
    id: 'pattern',
    icon: '🔍',
    // Needs the whole history, not just the open session: a pattern is by
    // definition the thing that repeats across sessions.
    needsHistory: true,
    label:   'Find my pattern',
    message: 'Find the recurring patterns in the way I think.',
    directive: {
      ru: `Задача этого ответа: мягко показать повторяющиеся мыслительные паттерны и возможные когнитивные искажения (обесценивание позитива, катастрофизация, чёрно-белое мышление, чтение мыслей, персонализация, долженствование и другие) по материалам пользователя выше — транскриптам сессий, истории эмоций и этому разговору.

Тон — обязательное требование:
— Ты НЕ ставишь диагноз и не навешиваешь ярлыки. Говори «я замечаю, что…», «возможно, здесь есть…», «похоже, иногда…». Никогда не пиши «у тебя катастрофизация» или «это когнитивное искажение».
— Каждое наблюдение подкрепляй конкретным примером из материалов пользователя — ситуацией или цитатой, по возможности с датой.
— Не больше двух-трёх наблюдений за раз: длинный список читается как приговор.
— Признавай, что за паттерном стоят реальные переживания и что он когда-то был нужен.
— Заверши ответ мягкой отсылкой: «это может быть полезно обсудить с твоим терапевтом».`,
      en: `The purpose of this reply: gently surface recurring thought patterns and possible cognitive distortions (discounting the positive, catastrophising, black-and-white thinking, mind reading, personalisation, "should" statements and others) from the user's material above — session transcripts, emotion history and this conversation.

Tone — this is a hard requirement:
— You do NOT diagnose and you do not apply labels. Say "I notice that…", "there might be something here…", "it looks like sometimes…". Never write "you catastrophise" or "this is a cognitive distortion".
— Ground every observation in a concrete example from the user's own material — a situation or a quote, with a date where you have one.
— No more than two or three observations at a time; a long list reads like a verdict.
— Acknowledge that a real experience sits underneath the pattern, and that it once served a purpose.
— Close with a soft hand-off: "this could be worth discussing with your therapist".`,
    },
  },
  {
    id: 'reframe',
    icon: '🔄',
    needsHistory: false,
    label:   'Help me reframe',
    message: 'Help me reframe this thought.',
    directive: {
      ru: `Задача этого ответа: помочь мягко переосмыслить мысль или ситуацию из этого разговора (CBT-переформулирование).

Тон — обязательное требование:
— Не переубеждай. Задавай вопросы и предлагай другой взгляд как возможность.
— Сначала назови мысль, с которой работаешь, и признай, что чувства реальны и обоснованы. НИКОГДА не обесценивай: не пиши «это просто искажение», «на самом деле всё хорошо», «не накручивай».
— Спроси: «Какие есть доказательства за и против этой мысли?» и «Что бы ты сказала подруге в такой ситуации?»
— Предложи более сбалансированную формулировку как вариант, а не как истину: «возможно, ближе было бы…», «как тебе такая формулировка?». Не настаивай, если не откликается.
— Если в разговоре пока нет конкретной мысли, с которой можно работать, — мягко попроси назвать её, а не придумывай за пользователя.
— Заверши ответ: «если это откликается — стоит проговорить с терапевтом».`,
      en: `The purpose of this reply: help the user gently reframe a thought or situation from this conversation (CBT-style reframing).

Tone — this is a hard requirement:
— Do not argue them out of it. Ask questions and offer another view as a possibility.
— Name the thought you are working with first, and acknowledge that the feelings are real and warranted. NEVER invalidate: do not write "that's just a distortion", "everything is actually fine", or "you're overthinking".
— Ask: "What is the evidence for and against this thought?" and "What would you say to a friend in this situation?"
— Offer a more balanced wording as an option, not as the truth: "maybe it's closer to…", "how does this wording land for you?". Do not insist if it does not resonate.
— If the conversation does not yet contain a specific thought to work with, gently ask for one rather than inventing it on the user's behalf.
— Close with: "if this resonates, it's worth talking through with your therapist".`,
    },
  },
];
