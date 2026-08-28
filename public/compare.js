const $ = (id) => document.getElementById(id);
// NOTE: iOS home-screen apps and Safari have SEPARATE storage — the key saved
// inside the installed app is not visible here. Hence the input field.
$('oai-key').value = localStorage.getItem('openai_api_key') || '';
const elKeyStored = localStorage.getItem('elevenlabs_api_key');
if (elKeyStored) $('el-key').value = elKeyStored;

let rec = null, chunks = [], stream = null;

function col(title) {
  const div = document.createElement('div');
  div.className = 'col';
  div.innerHTML = '<h3></h3><p dir="auto">…</p><div class="meta"></div>';
  div.querySelector('h3').textContent = title;
  $('results').prepend(div);
  return div;
}

async function openaiTranscribe(blob, model) {
  const form = new FormData();
  form.append('file', blob, blob.type.includes('mp4') ? 'note.m4a' : 'note.webm');
  form.append('model', model);
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + $('oai-key').value.trim() }, body: form,
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return { text: data.text, ms: Date.now() - t0 };
}

async function scribeTranscribe(blob, key) {
  const form = new FormData();
  form.append('file', blob, blob.type.includes('mp4') ? 'note.m4a' : 'note.webm');
  form.append('model_id', 'scribe_v1');
  const t0 = Date.now();
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': key }, body: form,
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return { text: data.text, ms: Date.now() - t0 };
}

function run(title, promise) {
  const div = col(title);
  promise.then(({ text, ms }) => {
    div.querySelector('p').textContent = text;
    div.querySelector('.meta').textContent = (ms / 1000).toFixed(1) + 's';
  }).catch((err) => {
    div.querySelector('p').textContent = 'FAILED: ' + err.message;
  });
}

$('btn').onclick = async () => {
  if (rec) { rec.stop(); return; }
  if (!$('oai-key').value.trim()) { alert('Paste your OpenAI API key first.'); return; }
  localStorage.setItem('openai_api_key', $('oai-key').value.trim());
  try {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Recording not supported in this browser');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Microphone failed: ' + (err.name || '') + ' ' + err.message +
      '\n\nIf you tapped "Don\'t Allow" before: iOS Settings \u2192 Apps \u2192 Safari \u2192 Microphone \u2192 Allow, or tap the \u1d00A button in the address bar \u2192 Website Settings \u2192 Microphone \u2192 Allow.');
    return;
  }
  chunks = [];
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' });
    stream.getTracks().forEach((t) => t.stop());
    rec = null;
    $('btn').textContent = '🎤 Record';
    $('btn').classList.remove('rec');
    $('player').src = URL.createObjectURL(blob);
    $('player').hidden = false;

    $('results').innerHTML = '';
    run('gpt-4o-transcribe (current)', openaiTranscribe(blob, 'gpt-4o-transcribe'));
    run('whisper-1', openaiTranscribe(blob, 'whisper-1'));
    const elKey = $('el-key').value.trim();
    if (elKey) {
      localStorage.setItem('elevenlabs_api_key', elKey);
      run('ElevenLabs Scribe', scribeTranscribe(blob, elKey));
    }
  };
  rec.start(1000);
  $('btn').textContent = '■ Stop';
  $('btn').classList.add('rec');
};
